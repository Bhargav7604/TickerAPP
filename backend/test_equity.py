import json
import datetime as dt
import time
from unittest.mock import Mock, patch

import pandas as pd
from django.test import TestCase

from .equity import cache_retry_ms, cached_broker_result, catalogue, quote_payload, stock_derivative_mask
from .models import LiveMarketFeed, User


def equity_frame():
    rows = [dict(exchange="NSE", segment="NSE", tradingsymbol="RELIANCE", name="RELIANCE INDUSTRIES",
                 instrument_type="EQ", instrument_token=1, lot_size=1, tick_size=.05, strike=0, expiry=pd.NaT)]
    for i, (name, kind, expiry, exchange) in enumerate([
        ("RELIANCE", "FUT", "2030-10-29", "NFO"), ("RELIANCE", "CE", "2030-10-29", "NFO"),
        ("RELIANCE", "PE", "2030-10-29", "NFO"), ("NIFTY", "FUT", "2030-10-29", "NFO"),
        ("FINNIFTY", "CE", "2030-10-29", "NFO"), ("GOLD", "FUT", "2030-10-29", "MCX"),
        ("RELIANCE", "FUT", "2020-10-29", "NFO"),
    ]):
        rows.append(dict(exchange=exchange, segment=exchange + ("-FUT" if kind == "FUT" else "-OPT"),
                         tradingsymbol=f"{name}{i}{kind}", name=name, instrument_type=kind,
                         instrument_token=100 + i, lot_size=500, tick_size=.05, strike=0 if kind == "FUT" else 1400,
                         expiry=pd.Timestamp(expiry)))
    frame = pd.DataFrame(rows)
    frame["stock_derivative"] = stock_derivative_mask(frame)
    return frame


class EquityTests(TestCase):
    def setUp(self):
        self.user = User(username="equity-test")
        self.user.set_password("local-test-password")
        self.user.save()
        response = self.client.post("/api/login/", json.dumps({"username": self.user.username, "password": "local-test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}
        self.reader = patch("backend.equity.get_master_contract", return_value=equity_frame())
        self.reader.start(); self.addCleanup(self.reader.stop)

    def test_only_stock_futures_and_options_survive_catalogue(self):
        self.assertEqual(set(catalogue().tradingsymbol), {"RELIANCE0FUT", "RELIANCE1CE", "RELIANCE2PE"})
        data = self.client.get("/api/equity/contracts/?q=RELIANCE&kind=all", **self.headers).json()
        self.assertEqual(len(data["contracts"]), 3)
        self.assertTrue(all(row["lotSize"] == 500 for row in data["contracts"]))
        self.assertNotIn("instrument_token", str(data))

    def test_missing_stock_marker_does_not_admit_index_or_other_derivatives(self):
        with patch("backend.equity.get_master_contract", return_value=equity_frame().drop(columns="stock_derivative")):
            self.assertTrue(catalogue().empty)

    def test_contract_search_and_exact_hydration(self):
        data = self.client.get("/api/equity/contracts/?q=RELIANCE%20CE&kind=all", **self.headers).json()
        self.assertEqual([row["kind"] for row in data["contracts"]], ["CE"])
        data = self.client.get("/api/equity/contracts/?ids=NFO:RELIANCE2PE", **self.headers).json()
        self.assertEqual(data["contracts"][0]["kind"], "PE")

    def test_options_browser_metadata_and_exact_filters(self):
        frame = equity_frame()
        extra = frame[frame.instrument_type.eq("CE") & frame.name.eq("RELIANCE")].copy()
        extra["expiry"] = pd.Timestamp("2030-11-26")
        extra["strike"] = 1500
        extra["tradingsymbol"] = "RELIANCE30NOV1500CE"
        with patch("backend.equity.get_master_contract", return_value=pd.concat([frame, extra], ignore_index=True)):
            initial = self.client.get("/api/equity/contracts/", {"kind": "options"}, **self.headers).json()
            self.assertEqual(initial["filters"]["stocks"], ["RELIANCE"])
            self.assertEqual(initial["filters"]["expiries"], ["2030-10-29", "2030-11-26"])
            self.assertEqual(initial["filters"]["strikes"], [1400])
            self.assertEqual({row["kind"] for row in initial["contracts"]}, {"CE", "PE"})
            data = self.client.get("/api/equity/contracts/", {"kind": "options", "underlying": "RELIANCE",
                "expiry": "2030-11-26", "strike": "1500", "option_type": "CE"}, **self.headers).json()
            self.assertEqual([row["symbol"] for row in data["contracts"]], ["RELIANCE30NOV1500CE"])
            self.assertEqual(data["filters"]["strikes"], [1500])

    def test_options_filters_reject_invalid_values_without_silent_fallback(self):
        for params in ({"underlying": "NIFTY"}, {"underlying": "RELI"}, {"expiry": "2020-10-29"},
                       {"strike": "1500"}, {"strike": "nan"}, {"strike": "bad"}, {"option_type": "FUT"},
                       {"page": "-1"}, {"page": "bad"}):
            response = self.client.get("/api/equity/contracts/", {"kind": "options", **params}, **self.headers)
            self.assertEqual(response.status_code, 400, params)

    def test_options_pagination_keeps_all_strikes_available(self):
        template = equity_frame().iloc[2].to_dict()
        rows = [{**template, "strike": strike, "tradingsymbol": f"RELIANCE{strike}{kind}", "instrument_type": kind}
                for strike in range(1000, 1400, 10) for kind in ("CE", "PE")]
        with patch("backend.equity.get_master_contract", return_value=pd.DataFrame(rows)):
            first = self.client.get("/api/equity/contracts/", {"kind": "options"}, **self.headers).json()
            second = self.client.get("/api/equity/contracts/", {"kind": "options", "page": 1}, **self.headers).json()
            self.assertEqual(first["total"], 80)
            self.assertEqual(len(first["contracts"]), 49)
            self.assertEqual(len(second["contracts"]), 31)
            self.assertEqual(len(first["filters"]["strikes"]), 40)
            self.assertFalse({row["id"] for row in first["contracts"]} & {row["id"] for row in second["contracts"]})

    def test_empty_options_catalogue_has_empty_selectors(self):
        with patch("backend.equity.get_master_contract", return_value=equity_frame().iloc[0:0]):
            response = self.client.get("/api/equity/contracts/", {"kind": "options"}, **self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["filters"]["stocks"], [])
            self.assertEqual(response.json()["total"], 0)

    def test_authenticated_get_only(self):
        for route in ("contracts", "quotes", "history"):
            self.assertNotEqual(self.client.get(f"/api/equity/{route}/").status_code, 200)
            self.assertEqual(self.client.post(f"/api/equity/{route}/", **self.headers).status_code, 405)

    @patch("backend.equity.broker")
    def test_cash_index_expired_and_arbitrary_contracts_never_reach_broker(self, broker):
        for symbol in ("NSE:RELIANCE", "NFO:NIFTY3FUT", "NFO:RELIANCE6FUT", "NFO:FAKE"):
            response = self.client.get("/api/equity/quotes/", {"ids": symbol}, **self.headers)
            self.assertEqual(response.status_code, 400)
        broker.assert_not_called()

    def test_quote_limit(self):
        response = self.client.get("/api/equity/quotes/", {"ids": ",".join(f"NFO:TEST{i}" for i in range(51))}, **self.headers)
        self.assertEqual(response.status_code, 400)

    def test_no_broker_session_reports_offline_without_sample_fallback(self):
        data = self.client.get("/api/equity/quotes/?ids=NFO:RELIANCE0FUT", **self.headers).json()
        self.assertEqual(data["status"], "offline")
        self.assertEqual(data["quotes"], {})

    def test_lot_conversion_and_missing_depth(self):
        data = quote_payload({"last_price": 110, "volume": 1000, "oi": 2500, "ohlc": {"close": 100},
                              "depth": {"buy": [{"price": 109, "quantity": 1500}], "sell": [{"price": 0, "quantity": 0}]}}, 500)
        self.assertAlmostEqual(data["changePct"], 10)
        self.assertEqual(data["volumeLots"], 2)
        self.assertEqual(data["oiLots"], 5)
        self.assertEqual(data["depth"]["buy"][0]["lots"], 3)
        self.assertIsNone(data["ask"])
        self.assertIsNone(quote_payload({}, 500)["ltp"])

    def test_untraded_contract_has_no_zero_ohlc_or_epoch_trade_time(self):
        data = quote_payload({"last_price": 221.65, "volume": 0, "average_price": 0,
                              "ohlc": {"open": 0, "high": 0, "low": 0, "close": 221.65},
                              "last_trade_time": dt.datetime(1970, 1, 1, 5, 30)}, 800)
        self.assertEqual(data["ohlc"], {"open": None, "high": None, "low": None, "close": 221.65})
        self.assertIsNone(data["vwap"])
        self.assertIsNone(data["lastTradeAt"])
        self.assertEqual(data["change"], 0)
        self.assertEqual(data["volumeLots"], 0)

    def test_cache_reuses_quotes_and_does_not_touch_index_feed(self):
        LiveMarketFeed.objects.create(pk=1, payload={"status": "live", "ticks": {"123": {"last_price": 42}}})
        fetch = Mock(return_value={"NFO:A": {"ltp": 123}})
        for _ in range(2):
            data = cached_broker_result(2, "session", ["NFO:A"], 3, fetch)
            self.assertEqual(data["NFO:A"]["data"]["ltp"], 123)
        fetch.assert_called_once()
        self.assertEqual(LiveMarketFeed.objects.get(pk=1).payload["ticks"]["123"]["last_price"], 42)
        self.assertEqual(cached_broker_result(2, "new-session", ["NFO:A"], 3, fetch), {})

    def test_cross_worker_cooldown_prevents_another_broker_request(self):
        fetch = Mock(return_value={"A": {"ltp": 1}})
        cached_broker_result(2, "session", ["A"], 3, fetch)
        self.assertEqual(cached_broker_result(2, "session", ["B"], 3, fetch), {})
        fetch.assert_called_once()

    @patch("backend.equity.time.time")
    @patch("backend.equity.broker")
    def test_partial_quotes_retry_at_cooldown_then_complete(self, broker, clock):
        clock.return_value = 100
        client = Mock()
        broker.return_value = (client, "session")
        client.quote.side_effect = lambda ids: {key: {"last_price": 25} for key in ids}
        self.client.get("/api/equity/quotes/", {"ids": "NFO:RELIANCE0FUT"}, **self.headers)
        ids = "NFO:RELIANCE0FUT,NFO:RELIANCE1CE"
        waiting = self.client.get("/api/equity/quotes/", {"ids": ids}, **self.headers).json()
        self.assertEqual(waiting["status"], "waiting")
        self.assertGreaterEqual(waiting["retryAfterMs"], 1099)
        self.assertLessEqual(waiting["retryAfterMs"], 1101)
        self.assertIn("NFO:RELIANCE0FUT", waiting["quotes"])
        client.quote.assert_called_once()
        clock.return_value = 101.2
        ready = self.client.get("/api/equity/quotes/", {"ids": ids}, **self.headers).json()
        self.assertEqual(ready["status"], "ready")
        self.assertIsNone(ready["retryAfterMs"])
        self.assertEqual(len(ready["quotes"]), 2)
        client.quote.assert_called_with(["NFO:RELIANCE1CE"])

    @patch("backend.equity.broker")
    def test_missing_broker_quote_is_unavailable_not_permanently_loading(self, broker):
        broker.return_value = (Mock(quote=Mock(return_value={})), "session")
        response = self.client.get("/api/equity/quotes/", {"ids": "NFO:RELIANCE1CE"}, **self.headers).json()
        self.assertEqual(response["status"], "ready")
        self.assertIsNone(response["retryAfterMs"])
        self.assertEqual(response["unavailableIds"], ["NFO:RELIANCE1CE"])

    @patch("backend.equity.time.time", return_value=100)
    def test_inflight_history_lease_returns_short_retry(self, clock):
        LiveMarketFeed.objects.create(pk=3, lease_until=115)
        self.assertEqual(cache_retry_ms(3, {}, ["history"], 60), 1500)

    @patch("backend.equity.broker")
    def test_quote_output_contains_only_public_fields(self, broker):
        client = Mock()
        broker.return_value = (client, "session-fingerprint")
        client.quote.return_value = {"NFO:RELIANCE0FUT": {"last_price": 99, "access_token": "NEVER-EXPOSE", "ohlc": {"close": 100}}}
        response = self.client.get("/api/equity/quotes/?ids=NFO:RELIANCE0FUT", **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("NEVER-EXPOSE", response.content.decode())
        self.assertNotIn("session-fingerprint", response.content.decode())
        self.assertEqual(response.json()["quotes"]["NFO:RELIANCE0FUT"]["ltp"], 99)

    @patch("backend.equity.broker")
    def test_broker_failure_never_leaks_credentials(self, broker):
        client = Mock()
        broker.return_value = (client, "session")
        client.quote.side_effect = RuntimeError("access_token=secret")
        response = self.client.get("/api/equity/quotes/?ids=NFO:RELIANCE0FUT", **self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret", response.content.decode())

    def test_history_accepts_exactly_one_active_stock_contract(self):
        for ids in ("", "NSE:RELIANCE", "NFO:RELIANCE0FUT,NFO:RELIANCE1CE"):
            self.assertEqual(self.client.get("/api/equity/history/", {"ids": ids}, **self.headers).status_code, 400)

    @patch("backend.equity.dt")
    @patch("backend.equity.cached_broker_result")
    @patch("backend.equity.broker")
    def test_history_preserves_broker_ohlc_and_converts_volume_to_lots(self, broker, cached, clock):
        now = dt.datetime(2026, 10, 13, 11, 30, tzinfo=dt.timezone(dt.timedelta(hours=5, minutes=30)))
        clock.datetime.now.return_value = now
        client = Mock()
        broker.return_value = (client, "test-session")
        client.historical_data.return_value = [{"date": now, "open": 99, "high": 102, "low": 98, "close": 101, "volume": 1500}]
        cached.side_effect = lambda cache_id, session, keys, ttl, fetch: {key: {"data": value, "at": time.time()} for key, value in fetch(keys).items()}
        response = self.client.get("/api/equity/history/", {"ids": "NFO:RELIANCE0FUT"}, **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["candles"], [{"time": int(now.timestamp()), "open": 99, "high": 102, "low": 98, "close": 101, "volume": 3}])

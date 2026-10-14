import datetime as dt
import json
from unittest.mock import Mock, patch

import pandas as pd
from django.test import TestCase

from .equity import IST, catalogue
from .models import User
from .test_equity import equity_frame


def index_frame():
    rows = []
    for name, exchange, strike, lots in (("NIFTY", "NFO", 22500, 65),
                                         ("BANKNIFTY", "NFO", 55000, 30),
                                         ("SENSEX", "BFO", 72500, 20)):
        for expiry in ("2030-10-01", "2030-10-08", "2030-11-05"):
            for side in ("CE", "PE"):
                rows.append(dict(name=name, exchange=exchange, segment=exchange + "-OPT",
                                 tradingsymbol=name + expiry.replace("-", "") + str(strike) + side,
                                 instrument_type=side, instrument_token=1000 + len(rows),
                                 lot_size=lots, tick_size=.05, strike=strike,
                                 expiry=pd.Timestamp(expiry), stock_derivative=False))
    invalid = [dict(rows[0], tradingsymbol="NIFTYWRONGEXCHANGE", exchange="BFO", segment="BFO-OPT"),
               dict(rows[-1], tradingsymbol="SENSEXWRONGEXCHANGE", exchange="NFO", segment="NFO-OPT"),
               dict(rows[0], tradingsymbol="NIFTYEXPIRED", expiry=pd.Timestamp("2020-01-01")),
               dict(rows[0], tradingsymbol="NIFTYZEROLOT", lot_size=0),
               dict(rows[0], tradingsymbol="NIFTYWRONGSEGMENT", segment="NFO-FUT")]
    return pd.concat([equity_frame(), pd.DataFrame(rows + invalid)], ignore_index=True)


class IndexOptionsTests(TestCase):
    def setUp(self):
        user = User(username="index-options-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}
        reader = patch("backend.equity.get_master_contract", return_value=index_frame())
        reader.start()
        self.addCleanup(reader.stop)
        self.sensex = "BFO:SENSEX2030100172500CE"

    def get(self, route="contracts", **params):
        return self.client.get(f"/api/index-options/{route}/", params, **self.headers)

    def test_catalogue_includes_only_active_options_on_correct_exchange(self):
        rows = catalogue(index_options=True)
        self.assertEqual(len(rows), 18)
        self.assertEqual(set(rows.name), {"NIFTY", "BANKNIFTY", "SENSEX"})
        self.assertEqual(set(rows.instrument_type), {"CE", "PE"})
        self.assertEqual(set(rows[rows.name.eq("SENSEX")].exchange), {"BFO"})
        self.assertEqual(set(catalogue().name), {"RELIANCE"})

    def test_metadata_exposes_exact_weekly_expiries_and_all_three_indices(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["filters"]["indices"], ["NIFTY", "BANKNIFTY", "SENSEX"])
        self.assertEqual(data["filters"]["underlying"], "NIFTY")
        self.assertEqual(data["filters"]["expiries"], ["2030-10-01", "2030-10-08", "2030-11-05"])
        self.assertEqual(data["filters"]["strikes"], [22500])
        self.assertEqual(data["total"], 2)

    def test_filters_select_each_index_and_exact_expiry_strike_side(self):
        for name, strike in (("NIFTY", 22500), ("BANKNIFTY", 55000), ("SENSEX", 72500)):
            data = self.get(underlying=name, expiry="2030-10-08", strike=strike, option_type="PE").json()
            self.assertEqual(len(data["contracts"]), 1)
            row = data["contracts"][0]
            self.assertEqual((row["underlying"], row["expiry"], row["strike"], row["kind"]),
                             (name, "2030-10-08", strike, "PE"))
            self.assertTrue(row["id"].startswith("BFO:" if name == "SENSEX" else "NFO:"))

    def test_invalid_filters_and_stock_names_are_rejected(self):
        for params in ({"kind": "FUT"}, {"underlying": "RELIANCE"}, {"underlying": "FINNIFTY"},
                       {"expiry": "2030-10-02"}, {"strike": "nan"}, {"option_type": "FUT"}):
            self.assertEqual(self.get(**params).status_code, 400, params)

    def test_search_and_saved_ids_remain_scoped(self):
        self.assertEqual(self.get(kind="all", q="RELIANCE").json()["contracts"], [])
        data = self.get(kind="all", q="SENSEX CE").json()["contracts"]
        self.assertEqual(len(data), 3)
        self.assertTrue(all(row["id"].startswith("BFO:") for row in data))
        self.assertEqual([row["id"] for row in self.get(ids=self.sensex + ",NFO:RELIANCE1CE").json()["contracts"]], [self.sensex])

    def test_authenticated_get_only(self):
        for route in ("contracts", "quotes", "history"):
            self.assertNotEqual(self.client.get(f"/api/index-options/{route}/").status_code, 200)
            self.assertEqual(self.client.post(f"/api/index-options/{route}/", **self.headers).status_code, 405)

    def test_strike_search_accepts_plain_comma_and_spaced_numbers(self):
        expected = self.get(kind="all", q="BANKNIFTY 55000 CE").json()["contracts"]
        self.assertEqual(len(expected), 3)
        for query in ("bank nifty 55000 CE", "Bank Nifty 55,000 CE", "BANKNIFTY 55 000 CE"):
            self.assertEqual(self.get(kind="all", q=query).json()["contracts"], expected, query)
        self.assertEqual(self.get(kind="all", q="BANKNIFTY 55,001 CE").json()["contracts"], [])

    @patch("backend.equity.broker")
    def test_out_of_scope_quotes_and_history_never_reach_broker(self, broker):
        for value in ("NFO:RELIANCE1CE", "NFO:NIFTY3FUT", "NFO:NIFTYEXPIRED", "NFO:NIFTYZEROLOT",
                      self.sensex.replace("BFO:", "NFO:"), "BFO:FAKE"):
            for route in ("quotes", "history"):
                self.assertEqual(self.get(route, ids=value).status_code, 400, value)
        for route in ("quotes", "history"):
            self.assertEqual(self.client.get(f"/api/equity/{route}/", {"ids": self.sensex}, **self.headers).status_code, 400)
        broker.assert_not_called()

    @patch("backend.equity.broker")
    def test_sensex_quotes_use_bfo_and_instrument_lot_size(self, broker):
        client = Mock()
        broker.return_value = (client, "session")
        client.quote.return_value = {self.sensex: {"last_price": 100, "volume": 200, "oi": 1000,
                                                 "depth": {"buy": [{"price": 99, "quantity": 60}]}}}
        response = self.get("quotes", ids=self.sensex)
        self.assertEqual(response.status_code, 200)
        client.quote.assert_called_once_with([self.sensex])
        quote = response.json()["quotes"][self.sensex]
        self.assertEqual((quote["volumeLots"], quote["oiLots"], quote["depth"]["buy"][0]["lots"]), (10, 50, 3))

    @patch("backend.equity.time.time", return_value=100)
    @patch("backend.equity.broker")
    def test_equity_and_index_options_share_quote_cooldown(self, broker, clock):
        client = Mock()
        broker.return_value = (client, "session")
        client.quote.side_effect = lambda ids: {key: {"last_price": 100} for key in ids}
        self.client.get("/api/equity/quotes/", {"ids": "NFO:RELIANCE0FUT"}, **self.headers)
        waiting = self.get("quotes", ids=self.sensex).json()
        self.assertEqual(waiting["status"], "waiting")
        self.assertGreaterEqual(waiting["retryAfterMs"], 1099)
        client.quote.assert_called_once()
        clock.return_value = 101.2
        self.assertEqual(self.get("quotes", ids=self.sensex).json()["status"], "ready")
        client.quote.assert_called_with([self.sensex])

    @patch("backend.equity.dt")
    @patch("backend.equity.broker")
    def test_sensex_chart_uses_correct_token_five_minute_interval_and_lots(self, broker, date_module):
        now = dt.datetime(2030, 10, 1, 11, 30, tzinfo=IST)
        date_module.datetime.now.return_value = now
        client = Mock()
        broker.return_value = (client, "session")
        client.historical_data.return_value = [{"date": now, "close": 101, "volume": 200}]
        data = self.get("history", ids=self.sensex).json()
        client.historical_data.assert_called_once_with(1012, now.replace(hour=9, minute=15), now, "5minute", oi=True)
        self.assertEqual(data["candles"], [{"time": int(now.timestamp()), "open": None, "high": None, "low": None, "close": 101, "volume": 10}])

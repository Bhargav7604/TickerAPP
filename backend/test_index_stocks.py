import datetime as dt
import json
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from django.test import TestCase

from . import index_stocks
from .index_stocks import (breadth, heatmap_payload, index_payload, nearest_futures, previous_candle, quote_batches,
                           refresh_stock_history, sector_flow, stock_row, sync_index_constituents)
from .market_contracts import MARKET_TZ
from .models import IndexConstituent, StockDailyHistory, User

NOW = dt.datetime(2026, 11, 2, 11, 0, tzinfo=MARKET_TZ)
SESSION = "2026-11-02"


def member(symbol, sector="Private Banks", company=""):
    return SimpleNamespace(symbol=symbol, sector=sector, company=company or symbol)


def history(symbol="HDFCBANK", futures_symbol="HDFCBANK26NOVFUT", oi=1000):
    return SimpleNamespace(symbol=symbol, futures_symbol=futures_symbol, futures_oi={"2026-10-30": oi},
                           candles=[["2026-10-29", 985, 995, 975, 990], ["2026-10-30", 990, 1004, 980, 1000]])


def raw_quote(ltp, close, open_=None, high=None, low=None, vwap=None, oi=None, token=1):
    return {"last_price": ltp, "ohlc": {"close": close, "open": open_ or close, "high": high or max(ltp, close), "low": low or min(ltp, close)},
            "average_price": vwap or 0, "volume": 1000, "oi": oi, "instrument_token": token,
            "last_trade_time": dt.datetime(2026, 11, 2, 10, 59)}


class StockRowTests(TestCase):
    def test_reads_change_vwap_range_pivots_and_buildup(self):
        cash = {"ltp": 1010.0, "close": 1000.0, "open": 1000.0, "high": 1020.0, "low": 995.0, "vwap": 1005.0, "volume": 5}
        fut = {"symbol": "HDFCBANK26NOVFUT", "ltp": 1015.0, "close": 1004.0, "oi": 1100}
        row = stock_row(member("HDFCBANK"), cash, fut, history(), SESSION)
        self.assertEqual((row["changePct"], row["vsVwapPct"], row["rangePos"]), (1.0, 0.5, 0.6))
        self.assertEqual(row["pivots"], {"s2": 970.67, "s1": 985.33, "p": 994.67, "r1": 1009.33, "r2": 1018.67,
                                         "prevHigh": 1004, "prevLow": 980})
        self.assertEqual((row["futures"]["oiChange"], row["futures"]["oiChangePct"], row["futures"]["code"]), (100, 10.0, "LB"))
        self.assertEqual((row["bull"], row["bear"], row["score"], row["state"]), (4, 0, 4, "bullish"))

    def test_state_needs_three_agreeing_checks(self):
        mixed = {"ltp": 1001.0, "close": 1000.0, "open": 1003.0, "high": 1005.0, "low": 999.0, "vwap": 1002.0}
        self.assertEqual(stock_row(member("A"), mixed, None, None, SESSION)["state"], "choppy")
        falling = {"ltp": 990.0, "close": 1000.0, "open": 998.0, "high": 1001.0, "low": 989.0, "vwap": 995.0}
        row = stock_row(member("B"), falling, None, None, SESSION)
        self.assertEqual((row["bear"], row["state"], row["pivots"], row["futures"]), (3, "bearish", None, None))

    def test_futures_baseline_ignored_after_rollover(self):
        cash = {"ltp": 1010.0, "close": 1000.0, "open": 1000.0, "high": 1020.0, "low": 995.0, "vwap": 1005.0}
        fut = {"symbol": "HDFCBANK26DECFUT", "ltp": 1015.0, "close": 1004.0, "oi": 1100}
        row = stock_row(member("HDFCBANK"), cash, fut, history(), SESSION)
        self.assertIsNone(row["futures"]["oiChange"])
        self.assertEqual([check["name"] for check in row["checks"]], ["Change", "VWAP", "Open"])

    def test_previous_candle_is_the_session_before_the_live_quote(self):
        saved = history()
        saved.candles.append(["2026-11-02", 1000, 1010, 995, 1005])
        self.assertEqual(previous_candle(saved, SESSION)[0], "2026-10-30")
        self.assertEqual(previous_candle(saved, "2026-10-30")[0], "2026-10-29")
        self.assertIsNone(previous_candle(None, SESSION))

    def test_breadth_mood_and_sector_flow(self):
        rows = [{"changePct": pct, "state": state, "sector": sector, "symbol": symbol} for symbol, pct, state, sector in (
            ("A", 2.0, "bullish", "IT"), ("B", 1.0, "bullish", "IT"), ("C", 0.5, "choppy", "Auto"),
            ("D", 0.2, "choppy", "Auto"), ("E", -1.0, "bearish", "Metals"), ("F", 0.0, "choppy", "Metals"))]
        summary = breadth(rows)
        self.assertEqual((summary["up"], summary["down"], summary["flat"]), (4, 1, 1))
        self.assertEqual((summary["mood"], summary["moodSide"], summary["bullish"], summary["choppy"]), ("One-sided rally", "up", 2, 3))
        self.assertEqual([sector["name"] for sector in sector_flow(rows)], ["IT", "Auto", "Metals"])
        self.assertEqual(sector_flow(rows)[-1]["stocks"], [{"symbol": "F", "changePct": 0.0}, {"symbol": "E", "changePct": -1.0}])
        self.assertEqual(breadth([{"changePct": -1, "state": "bearish"}] * 3 + [{"changePct": 1, "state": "bullish"}] * 2)["mood"],
                         "More stocks falling")

    def test_nearest_futures_picks_the_nearest_expiry(self):
        frame = pd.DataFrame([
            {"name": "HDFCBANK", "tradingsymbol": "HDFCBANK26DECFUT", "instrument_token": 2, "instrument_type": "FUT", "expiry": pd.Timestamp("2026-12-29")},
            {"name": "HDFCBANK", "tradingsymbol": "HDFCBANK26NOVFUT", "instrument_token": 1, "instrument_type": "FUT", "expiry": pd.Timestamp("2026-11-24")},
            {"name": "HDFCBANK", "tradingsymbol": "HDFCBANK26NOV1700CE", "instrument_token": 3, "instrument_type": "CE", "expiry": pd.Timestamp("2026-11-24")},
            {"name": "SBIN", "tradingsymbol": "SBIN26NOVFUT", "instrument_token": 4, "instrument_type": "FUT", "expiry": pd.Timestamp("2026-11-24")},
        ])
        with patch("backend.index_stocks.catalogue", return_value=frame):
            self.assertEqual(nearest_futures(["HDFCBANK"]), {"HDFCBANK": ("HDFCBANK26NOVFUT", 1)})


class FakeKite:
    def __init__(self):
        self.quotes = {
            "NSE:HDFCBANK": raw_quote(1010, 1000, 1000, 1020, 995, 1005, token=11),
            "NSE:SBIN": raw_quote(780, 800, 795, 801, 778, 785, token=12),
            "NSE:PNB": raw_quote(101, 100, 100.5, 102, 99, 100.8, token=13),
            "NFO:HDFCBANK26NOVFUT": raw_quote(1015, 1004, oi=1100, token=21),
            "NSE:NIFTY BANK": raw_quote(56500, 56000, token=31),
        }
        self.history_calls = []

    def quote(self, names):
        return {name: self.quotes[name] for name in names if name in self.quotes}

    def ltp(self, names):
        return {name: {"instrument_token": self.quotes[name]["instrument_token"]} for name in names if name in self.quotes}

    def historical_data(self, token, start, end, interval, oi=False):
        self.history_calls.append((token, oi))
        day = dt.datetime(2026, 10, 30, tzinfo=MARKET_TZ)
        return [{"date": day, "open": 990, "high": 1004, "low": 980, "close": 1000, "oi": 1000 if oi else 0}]


class PayloadTests(TestCase):
    def setUp(self):
        IndexConstituent.objects.all().delete()
        for symbol, sector in (("HDFCBANK", "Private Banks"), ("SBIN", "PSU Banks"), ("PNB", "PSU Banks")):
            IndexConstituent.objects.create(index_key="banknifty", symbol=symbol, company=symbol, sector=sector)
        StockDailyHistory.objects.create(symbol="HDFCBANK", candles=history().candles, futures_symbol="HDFCBANK26NOVFUT",
                                         futures_oi={"2026-10-30": 1000}, updated_on=NOW.date())
        self.kite = FakeKite()

    def payload(self):
        with patch("backend.index_stocks.broker", return_value=(self.kite, "session")), \
                patch("backend.index_stocks.nearest_futures", return_value={"HDFCBANK": ("HDFCBANK26NOVFUT", 21)}):
            return index_payload("banknifty", NOW)

    def test_ranks_stocks_and_summarises_the_index(self):
        data = self.payload()
        self.assertEqual([(row["rank"], row["symbol"]) for row in data["stocks"]], [(1, "HDFCBANK"), (2, "PNB"), (3, "SBIN")])
        self.assertEqual(data["stocks"][0]["futures"]["code"], "LB")
        self.assertEqual((data["breadth"]["up"], data["breadth"]["down"], data["breadth"]["mood"]), (2, 1, "More stocks rising"))
        self.assertEqual((data["leading"]["name"], data["lagging"]["name"]), ("Private Banks", "PSU Banks"))
        self.assertEqual(data["spot"], {"ltp": 56500.0, "change": 500.0, "changePct": 0.89})
        self.assertEqual((data["sessionDate"], data["levelsReady"], data["missing"], data["message"]), (SESSION, 1, [], ""))

    def test_missing_quotes_and_offline_broker(self):
        del self.kite.quotes["NSE:PNB"]
        self.assertEqual(self.payload()["missing"], ["PNB"])
        with patch("backend.index_stocks.broker", return_value=(None, None)):
            self.assertIn("not connected", index_payload("banknifty", NOW)["message"])

    def test_api_requires_login_and_a_known_index(self):
        self.assertEqual(self.client.get("/api/index-stocks/").status_code, 400)
        user = User(username="screen-user")
        user.set_password("test-password")
        user.save()
        login = self.client.post("/api/login/", json.dumps({"username": "screen-user", "password": "test-password"}), content_type="application/json")
        headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}
        self.assertEqual(self.client.get("/api/index-stocks/?index=midcap", **headers).status_code, 400)
        with patch("backend.index_stocks.index_payload", return_value={"stocks": [], "label": "BANK NIFTY"}):
            response = self.client.get("/api/index-stocks/?index=banknifty", **headers)
        self.assertEqual(response.json()["type"], "success")


class HistoryAndListTests(TestCase):
    def setUp(self):
        IndexConstituent.objects.all().delete()
        for symbol in ("HDFCBANK", "PNB", "SBIN"):
            IndexConstituent.objects.create(index_key="banknifty", symbol=symbol)
        self.kite = FakeKite()

    def test_saves_daily_candles_within_the_call_budget(self):
        with patch("backend.index_stocks.nearest_futures", return_value={"HDFCBANK": ("HDFCBANK26NOVFUT", 21)}), \
                patch("backend.index_stocks.time.sleep"):
            self.assertEqual(refresh_stock_history(self.kite, NOW, max_calls=4), 2)
            saved = StockDailyHistory.objects.get(symbol="HDFCBANK")
            self.assertEqual((saved.candles, saved.futures_oi), ([["2026-10-30", 990, 1004, 980, 1000]], {"2026-10-30": 1000}))
            self.assertEqual(StockDailyHistory.objects.get(symbol="PNB").futures_symbol, "")
            self.assertEqual(refresh_stock_history(self.kite, NOW, max_calls=4), 1)
            self.assertEqual(refresh_stock_history(self.kite, NOW, max_calls=4), 0)

    def test_sync_replaces_nse_lists_and_keeps_them_on_bad_downloads(self):
        IndexConstituent.objects.create(index_key="sensex", symbol="RELIANCE")
        bank_csv = "Company Name,Industry,Symbol,Series,ISIN Code\n" + "".join(
            f"{symbol} Ltd.,Financial Services,{symbol},EQ,X\n" for symbol in
            ("AUBANK", "AXISBANK", "BANKBARODA", "CANBK", "FEDERALBNK", "HDFCBANK", "ICICIBANK", "IDFCFIRSTB", "PNB", "SBIN", "UNIONBANK"))

        def get(url, **_):
            if "niftybank" not in url:
                raise OSError("down")
            return SimpleNamespace(text=bank_csv, raise_for_status=lambda: None)

        self.assertEqual(sync_index_constituents(get), {"banknifty": 11})
        self.assertEqual(index_stocks.parse_nse_list(
            "Company Name,Industry,Symbol,Series,ISIN Code\nHFCL Ltd.,Telecommunication,HFCL,BE,X\nDummy HEG Ltd.,Capital Goods,DUMMYHEG,EQ,X\n", "nifty500"),
            [("HFCL", "HFCL Ltd.", "Telecom", "BE")])
        bank = dict(IndexConstituent.objects.filter(index_key="banknifty").values_list("symbol", "sector"))
        self.assertEqual((len(bank), bank["CANBK"], bank["AXISBANK"]), (11, "PSU Banks", "Private Banks"))
        short = SimpleNamespace(text="Company Name,Industry,Symbol,Series,ISIN Code\nA,B,C,EQ,X\n", raise_for_status=lambda: None)
        self.assertEqual(sync_index_constituents(lambda url, **_: short), {})
        self.assertEqual(IndexConstituent.objects.filter(index_key="banknifty").count(), 11)
        self.assertTrue(IndexConstituent.objects.filter(index_key="sensex", symbol="RELIANCE").exists())


class SeedTests(TestCase):
    def test_migration_seeds_all_three_indices(self):
        counts = {key: IndexConstituent.objects.filter(index_key=key).count() for key in index_stocks.LABELS}
        self.assertEqual(counts, {"nifty": 50, "banknifty": 14, "sensex": 30})
        self.assertEqual(IndexConstituent.objects.filter(index_key="nifty500").count(), 500)
        self.assertEqual(IndexConstituent.objects.get(index_key="nifty500", symbol="EMBASSY").series, "RR")
        self.assertEqual(IndexConstituent.objects.get(index_key="sensex", symbol="INFY").sector, "IT")


class HeatmapTests(TestCase):
    def setUp(self):
        IndexConstituent.objects.all().delete()
        for symbol, sector in (("HDFCBANK", "Private Banks"), ("SBIN", "PSU Banks"), ("PNB", "PSU Banks")):
            IndexConstituent.objects.create(index_key="nifty500", symbol=symbol, company=symbol, sector=sector)
        self.kite = FakeKite()
        self.kite.quotes["NSE:NIFTY 500"] = raw_quote(21500, 21400, token=41)
        self.kite.quotes["NSE:SBIN"]["volume"] = 50000

    def test_boxes_are_sized_by_money_traded_and_grouped_by_sector(self):
        with patch("backend.index_stocks.broker", return_value=(self.kite, "session")):
            data = heatmap_payload("nifty500", NOW)
        self.assertEqual([(tile["symbol"], tile["value"], tile["changePct"]) for tile in data["tiles"]],
                         [("SBIN", 39000000, -2.5), ("HDFCBANK", 1010000, 1.0), ("PNB", 101000, 1.0)])
        self.assertEqual([(sector["name"], sector["value"], sector["avgChangePct"], sector["up"], sector["down"]) for sector in data["sectors"]],
                         [("PSU Banks", 39101000, -0.75, 1, 1), ("Private Banks", 1010000, 1.0, 1, 0)])
        self.assertEqual((data["breadth"]["up"], data["breadth"]["down"], data["breadth"]["mood"]), (2, 1, "More stocks rising"))
        self.assertEqual((data["label"], data["spot"]["changePct"], data["missing"]), ("NIFTY 500", 0.47, []))

    def test_non_eq_series_are_quoted_with_their_suffix(self):
        IndexConstituent.objects.create(index_key="nifty500", symbol="EMBASSY", company="Embassy REIT", sector="Realty", series="RR")
        self.kite.quotes["NSE:EMBASSY-RR"] = raw_quote(411.5, 405, token=51)
        with patch("backend.index_stocks.broker", return_value=(self.kite, "session")):
            data = heatmap_payload("nifty500", NOW)
        self.assertIn(("EMBASSY", 1.6), [(tile["symbol"], tile["changePct"]) for tile in data["tiles"]])
        self.assertEqual(data["missing"], [])

    def test_quote_requests_stay_within_the_broker_limits(self):
        calls = []
        client = SimpleNamespace(quote=lambda names: calls.append(len(names)) or {})
        with patch("backend.index_stocks.time.sleep") as sleep:
            quote_batches(client, [f"NSE:S{n}" for n in range(502)])
        self.assertEqual((calls, sleep.call_count), ([450, 52], 1))

    def test_daily_history_skips_heatmap_only_stocks(self):
        IndexConstituent.objects.create(index_key="nifty", symbol="HDFCBANK")
        with patch("backend.index_stocks.nearest_futures", return_value={}), patch("backend.index_stocks.time.sleep"):
            self.assertEqual(refresh_stock_history(self.kite, NOW), 1)
        self.assertEqual(list(StockDailyHistory.objects.values_list("symbol", flat=True)), ["HDFCBANK"])

    def test_api_accepts_nifty500(self):
        user = User(username="heat-user")
        user.set_password("test-password")
        user.save()
        login = self.client.post("/api/login/", json.dumps({"username": "heat-user", "password": "test-password"}), content_type="application/json")
        headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}
        with patch("backend.index_stocks.heatmap_payload", return_value={"tiles": []}):
            self.assertEqual(self.client.get("/api/index-stocks/heatmap/?index=nifty500", **headers).json()["type"], "success")
        self.assertEqual(self.client.get("/api/index-stocks/heatmap/?index=midcap", **headers).status_code, 400)

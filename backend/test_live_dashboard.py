import datetime as dt
import json
from unittest.mock import patch

import pandas as pd
from django.test import TestCase

from .live_dashboard import candles_payload, instrument, quotes_payload
from .market_contracts import MARKET_TZ
from .models import User

TODAY = dt.date(2026, 11, 13)


def contracts():
    rows = [("NFO", "NIFTY", "NIFTY26OCTFUT", "2026-10-27", 1), ("NFO", "NIFTY", "NIFTY26DECFUT", "2026-12-29", 2),
            ("NFO", "NIFTY", "NIFTY26NOVFUT", "2026-11-24", 3), ("CDS", "USDINR", "USDINR26N13FUT", "2026-11-13", 4),
            ("CDS", "USDINR", "USDINR26NOVFUT", "2026-11-26", 5), ("MCX", "CRUDEOIL", "CRUDEOIL26NOVFUT", "2026-11-19", 6),
            ("NCO", "CRUDEOIL", "CRUDEOIL26NOVFUT", "2026-11-19", 7), ("MCX", "CRUDEOIL", "CRUDEOIL26DECFUT", "2026-12-17", 8)]
    return pd.DataFrame([{"exchange": exchange, "name": name, "tradingsymbol": symbol, "expiry": pd.Timestamp(expiry),
                          "instrument_type": "FUT", "instrument_token": token} for exchange, name, symbol, expiry, token in rows])


def raw_quote(last, close, token):
    return {"last_price": last, "ohlc": {"close": close, "open": close, "high": max(last, close), "low": min(last, close)},
            "instrument_token": token, "last_trade_time": dt.datetime(2026, 11, 13, 13, 38, 11)}


class FakeKite:
    def __init__(self):
        self.quotes = {"NFO:NIFTY26NOVFUT": raw_quote(25161.4, 25308.7, 3), "NSE:NIFTY BANK": raw_quote(60967.75, 61518.5, 260105),
                       "NSE:INDIA VIX": raw_quote(16.0, 16.62, 264969), "MCX:CRUDEOIL26NOVFUT": raw_quote(8388, 8300, 6),
                       "CDS:USDINR26NOVFUT": raw_quote(94.345, 94.1225, 5)}
        self.history = []

    def quote(self, names):
        return {name: self.quotes[name] for name in names if name in self.quotes}

    def historical_data(self, token, start, end, interval):
        self.history.append((token, interval, start.date()))
        moment = dt.datetime(2026, 11, 13, 13, 35, tzinfo=MARKET_TZ)
        return [{"date": moment, "open": 8380, "high": 8395, "low": 8375, "close": 8390, "volume": 1200}]


class DashboardTests(TestCase):
    def setUp(self):
        for target, value in (("backend.live_dashboard.get_master_contract", contracts()), ("backend.live_dashboard.market_today", TODAY)):
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.kite = FakeKite()

    def test_picks_the_nearest_unexpired_monthly_contract(self):
        self.assertEqual(instrument("nifty-fut"), "NFO:NIFTY26NOVFUT")
        self.assertEqual(instrument("usd-inr"), "CDS:USDINR26NOVFUT")  # not the weekly USDINR26N13FUT
        self.assertEqual(instrument("crude-oil"), "MCX:CRUDEOIL26NOVFUT")  # MCX, not the NCO listing
        self.assertEqual(instrument("india-vix"), "NSE:INDIA VIX")

    def test_quotes_for_every_chart_with_change_from_yesterday(self):
        with patch("backend.live_dashboard.broker", return_value=(self.kite, "session")):
            data = quotes_payload()
        charts = {chart["id"]: chart for chart in data["charts"]}
        self.assertEqual(list(charts), ["nifty-fut", "banknifty", "india-vix", "crude-oil", "usd-inr"])
        self.assertEqual((charts["crude-oil"]["symbol"], charts["crude-oil"]["exchange"]), ("CRUDEOIL26NOVFUT", "MCX"))
        self.assertEqual((charts["crude-oil"]["change"], charts["crude-oil"]["changePct"]), (88, 1.06))
        self.assertEqual((charts["usd-inr"]["ltp"], charts["usd-inr"]["change"]), (94.345, 0.2225))
        self.assertEqual(charts["india-vix"]["tradedAt"], int(dt.datetime(2026, 11, 13, 13, 38, 11, tzinfo=MARKET_TZ).timestamp()))
        self.assertEqual(data["message"], "")

    def test_offline_broker_still_lists_the_charts(self):
        with patch("backend.live_dashboard.broker", return_value=(None, None)):
            data = quotes_payload()
        self.assertEqual(len(data["charts"]), 5)
        self.assertIsNone(data["charts"][0]["ltp"])
        self.assertIn("not connected", data["message"])

    def test_candles_use_the_contract_token_and_candle_size(self):
        with patch("backend.live_dashboard.broker", return_value=(self.kite, "session")):
            data = candles_payload("crude-oil", "15minute", now=dt.datetime(2026, 11, 13, 13, 40, tzinfo=MARKET_TZ))
        self.assertEqual(self.kite.history, [(6, "15minute", dt.date(2026, 10, 29))])
        self.assertEqual(data["symbol"], "CRUDEOIL26NOVFUT")
        self.assertEqual(data["candles"], [{"time": int(dt.datetime(2026, 11, 13, 13, 35, tzinfo=MARKET_TZ).timestamp()),
                                            "open": 8380, "high": 8395, "low": 8375, "close": 8390, "volume": 1200}])


class EndpointTests(TestCase):
    def setUp(self):
        user = User(username="dashboard-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_needs_login_and_known_charts(self):
        self.assertEqual(self.client.get("/api/dashboard/quotes/").json()["type"], "TokenException")
        self.assertEqual(self.client.get("/api/dashboard/candles/", {"id": "crude-oil"}).json()["type"], "TokenException")
        for params in ({"id": "gold"}, {"id": "crude-oil", "interval": "3minute"}):
            self.assertEqual(self.client.get("/api/dashboard/candles/", params, **self.headers).status_code, 400)
        with patch("backend.live_dashboard.quotes_payload", return_value={"charts": [], "message": ""}):
            self.assertEqual(self.client.get("/api/dashboard/quotes/", **self.headers).status_code, 200)

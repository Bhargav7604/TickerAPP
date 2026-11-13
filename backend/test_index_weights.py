import datetime as dt
import json
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from django.test import TestCase

from .index_weights import contribution_payload, contribution_sector, refresh_index_weights, solve_weights
from .market_contracts import MARKET_TZ
from .models import IndexConstituent, IndexWeights, User

NOW = dt.datetime(2026, 11, 13, 11, 0, tzinfo=MARKET_TZ)
STOCKS = (("HDFCBANK", "Financial Services", "HDFC Bank Ltd."), ("BAJFINANCE", "Financial Services", "Bajaj Finance Ltd."),
          ("INFY", "IT", "Infosys Ltd."), ("TCS", "IT", "Tata Consultancy Services Ltd."))
TRUE_POINTS_PER_RUPEE = {"HDFCBANK": 2.0, "BAJFINANCE": 0.5, "INFY": 1.5, "TCS": 0.4}


def minute_prices(sessions=4, minutes=200, seed=7):
    """Random-walk minute prices for each stock, and the index as their exact weighted sum."""
    rng = np.random.default_rng(seed)
    start = {"HDFCBANK": 1000.0, "BAJFINANCE": 900.0, "INFY": 1500.0, "TCS": 3500.0}
    times, prices = [], {symbol: [] for symbol in start}
    level = dict(start)
    for day in range(sessions):
        session = dt.datetime(2026, 11, 5 + day, 9, 15)
        for minute in range(minutes):
            times.append(session + dt.timedelta(minutes=minute))
            for symbol in start:
                level[symbol] *= 1 + rng.normal(0, 0.0015)
                prices[symbol].append(level[symbol])
    index = [sum(TRUE_POINTS_PER_RUPEE[symbol] * prices[symbol][i] for symbol in start) for i in range(len(times))]
    return times, prices, index


class FakeKite:
    def __init__(self, broken_index=False):
        self.times, self.prices, self.index = minute_prices()
        if broken_index:
            self.index = list(np.random.default_rng(1).normal(10000, 300, len(self.index)))
        self.tokens = {f"NSE:{symbol}": number for number, symbol in enumerate(TRUE_POINTS_PER_RUPEE, start=1)}
        self.tokens["NSE:NIFTY 50"] = 99
        self.quotes = {}

    def ltp(self, names):
        return {name: {"instrument_token": self.tokens[name]} for name in names if name in self.tokens}

    def historical_data(self, token, start, end, interval):
        assert interval == "minute" and end.date() < NOW.date()
        symbol = next(name for name, number in self.tokens.items() if number == token)
        values = self.index if symbol == "NSE:NIFTY 50" else self.prices[symbol.split(":")[1]]
        return [{"date": moment.replace(tzinfo=MARKET_TZ), "close": value} for moment, value in zip(self.times, values)]

    def quote(self, names):
        return {name: self.quotes[name] for name in names if name in self.quotes}


def add_stocks():
    IndexConstituent.objects.filter(index_key="nifty").delete()
    for symbol, sector, company in STOCKS:
        IndexConstituent.objects.create(index_key="nifty", symbol=symbol, sector=sector, company=company)


class SolveTests(TestCase):
    def test_recovers_the_weights_of_an_exact_weighted_sum(self):
        _, prices, index = minute_prices()
        matrix = np.array([prices[symbol] for symbol in TRUE_POINTS_PER_RUPEE]).T
        coefficients, gap = solve_weights(matrix, np.array(index))
        np.testing.assert_allclose(coefficients, list(TRUE_POINTS_PER_RUPEE.values()), rtol=1e-6)
        self.assertLess(gap, 1e-6)

    def test_never_returns_negative_weights(self):
        _, prices, _ = minute_prices()
        matrix = np.array([prices["HDFCBANK"], prices["INFY"]]).T
        index = 2 * matrix[:, 0] - 0.3 * matrix[:, 1]
        coefficients, _ = solve_weights(matrix, index)
        self.assertTrue((coefficients >= 0).all())

    def test_sector_groups(self):
        def member(symbol, sector, company=""):
            return SimpleNamespace(symbol=symbol, sector=sector, company=company)
        self.assertEqual(contribution_sector(member("HDFCBANK", "Financial Services", "HDFC Bank Ltd.")), "Banking")
        self.assertEqual(contribution_sector(member("SBIN", "Financial Services")), "Banking")
        self.assertEqual(contribution_sector(member("BAJFINANCE", "Financial Services", "Bajaj Finance Ltd.")), "NBFC & Finance")
        self.assertEqual(contribution_sector(member("RELIANCE", "Oil & Gas")), "Energy & OMC")
        self.assertEqual(contribution_sector(member("ASIANPAINT", "Consumer Durables")), "Chemicals")
        self.assertEqual(contribution_sector(member("TITAN", "Consumer Durables")), "Consumer & Retail")
        self.assertEqual(contribution_sector(member("LT", "Construction")), "Capital Goods & Infra")


class RefreshTests(TestCase):
    def setUp(self):
        add_stocks()

    def refresh(self, kite):
        with patch("backend.index_weights.time.sleep"):
            return refresh_index_weights("nifty", client=kite, now=NOW)

    def test_fits_and_saves_once_a_day(self):
        self.assertEqual(self.refresh(FakeKite()), "saved")
        weights = IndexWeights.objects.get(index_key="nifty")
        self.assertEqual((weights.computed_on, weights.sessions), (NOW.date(), 4))
        for symbol, value in TRUE_POINTS_PER_RUPEE.items():
            self.assertAlmostEqual(weights.coefficients[symbol], value, places=4)
        self.assertEqual(self.refresh(FakeKite()), "fresh")

    def test_a_poor_fit_keeps_the_previous_weights(self):
        IndexWeights.objects.create(index_key="nifty", computed_on=NOW.date() - dt.timedelta(days=1), coefficients={"HDFCBANK": 9})
        self.assertEqual(self.refresh(FakeKite(broken_index=True)), "rejected")
        self.assertEqual(IndexWeights.objects.get(index_key="nifty").coefficients, {"HDFCBANK": 9})

    def test_missing_instrument_keeps_the_previous_weights(self):
        kite = FakeKite()
        del kite.tokens["NSE:TCS"]
        self.assertEqual(self.refresh(kite), "missing instruments")
        self.assertFalse(IndexWeights.objects.exists())


def raw_quote(last, close):
    return {"last_price": last, "ohlc": {"close": close, "open": close, "high": max(last, close), "low": min(last, close)}}


class ContributionTests(TestCase):
    def setUp(self):
        add_stocks()
        IndexWeights.objects.create(index_key="nifty", computed_on=NOW.date(), sessions=6, fit_error=0.8, coefficients=TRUE_POINTS_PER_RUPEE)
        self.kite = FakeKite()
        self.kite.quotes = {"NSE:HDFCBANK": raw_quote(1010, 1000), "NSE:BAJFINANCE": raw_quote(890, 900),
                            "NSE:INFY": raw_quote(1520, 1500), "NSE:TCS": raw_quote(3450, 3500), "NSE:NIFTY 50": raw_quote(24025, 24000)}

    def payload(self):
        with patch("backend.index_weights.broker", return_value=(self.kite, "session")):
            return contribution_payload("nifty", NOW)

    def test_points_are_weight_times_move_summed_by_sector(self):
        data = self.payload()
        # HDFCBANK +10 x 2 = +20; BAJFINANCE -10 x 0.5 = -5; INFY +20 x 1.5 = +30; TCS -50 x 0.4 = -20.
        self.assertEqual([(sector["name"], sector["points"]) for sector in data["sectors"]],
                         [("Banking", 20.0), ("IT", 10.0), ("NBFC & Finance", -5.0)])
        it = data["sectors"][1]
        self.assertEqual([(stock["symbol"], stock["points"]) for stock in it["stocks"]], [("INFY", 30.0), ("TCS", -20.0)])
        self.assertEqual((data["indexMove"], data["explained"], data["weightsOn"], data["message"]), (25.0, 25.0, "2026-11-13", ""))

    def test_explains_missing_weights_and_offline_broker(self):
        with patch("backend.index_weights.broker", return_value=(None, None)):
            self.assertIn("not connected", contribution_payload("nifty", NOW)["message"])
        IndexWeights.objects.all().delete()
        self.assertIn("morning weight update", contribution_payload("nifty", NOW)["message"])


class EndpointTests(TestCase):
    def setUp(self):
        user = User(username="contribution-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_needs_login_and_supports_nifty_only(self):
        self.assertEqual(self.client.get("/api/index-stocks/contribution/").json()["type"], "TokenException")
        self.assertEqual(self.client.get("/api/index-stocks/contribution/", {"index": "banknifty"}, **self.headers).status_code, 400)
        with patch("backend.index_weights.contribution_payload", return_value={"sectors": [], "label": "NIFTY 50"}):
            response = self.client.get("/api/index-stocks/contribution/", **self.headers)
        self.assertEqual((response.status_code, response.json()["label"]), (200, "NIFTY 50"))

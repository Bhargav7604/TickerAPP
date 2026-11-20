import datetime as dt
import json
from unittest.mock import patch

import pandas as pd
from django.test import TestCase

from .commodities import commodities_payload, contracts, mcx_session, refresh_commodity_stats
from . import commodity_math as cm
from .commodity_home import (commodity_home_payload, contract_rows, futures_players, history_payload, insights_payload, overview_payload,
                             record_commodity_snapshot)
from .market_contracts import MARKET_TZ
from .models import MarketSnapshot, UniverseStats, User

FRIDAY = dt.date(2026, 11, 20)


def at(hour, minute=0, day=FRIDAY):
    return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=MARKET_TZ)


def frame():
    rows = [("CRUDEOIL", "2026-11-19", 1), ("CRUDEOIL", "2026-12-18", 2), ("CRUDEOIL", "2027-01-19", 3), ("CRUDEOIL", "2027-02-18", 4),
            ("NATURALGAS", "2026-11-24", 5), ("NATURALGAS", "2026-12-23", 6), ("GOLD", "2026-12-04", 7), ("GOLD", "2027-02-05", 8),
            ("SILVER", "2026-12-04", 9), ("COPPER", "2026-11-28", 10), ("ZINC", "2026-11-28", 11), ("CRUDEOILM", "2026-12-18", 12)]
    data = [{"exchange": "MCX", "segment": "MCX-FUT", "instrument_type": "FUT", "name": name, "expiry": pd.Timestamp(expiry),
             "tradingsymbol": f"{name}{pd.Timestamp(expiry):%y%b}FUT".upper(), "instrument_token": token, "lot_size": 1}
            for name, expiry, token in rows]
    data.append({"exchange": "NCO", "segment": "NCO-FUT", "instrument_type": "FUT", "name": "CRUDEOIL", "expiry": pd.Timestamp("2026-12-18"),
                 "tradingsymbol": "CRUDEOIL26DECFUT", "instrument_token": 99, "lot_size": 1})
    return pd.DataFrame(data)


def kite_quote(last, close, oi=None, buy=None, sell=None, vwap=None, traded=dt.datetime(2026, 11, 20, 14, 30)):
    return {"last_price": last, "ohlc": {"open": close, "high": max(last, close), "low": min(last, close), "close": close},
            "volume": 12000, "oi": oi, "buy_quantity": buy, "sell_quantity": sell, "average_price": vwap,
            "depth": {"buy": [{"price": last - 1, "quantity": 3}], "sell": [{"price": last + 1, "quantity": 2}]},
            "last_trade_time": traded, "instrument_token": 1}


def continuous_history(sessions=60, start=dt.date(2026, 9, 1), base=5000.0, step=5.0):
    """A steady climb with a fixed daily range: easy numbers for averages, ATR and pivots."""
    rows, day, price = [], start, base
    while len(rows) < sessions:
        if day.weekday() < 5:
            rows.append({"date": dt.datetime.combine(day, dt.time()), "open": price - 2, "high": price + 20, "low": price - 20, "close": price, "volume": 100})
            price += step
        day += dt.timedelta(days=1)
    return rows


class FakeKite:
    def __init__(self, quotes):
        self.quotes = quotes
        self.history_calls = []

    def quote(self, names):
        return {name: self.quotes[name] for name in names if name in self.quotes}

    def historical_data(self, token, start, end, interval, oi=False, continuous=False):
        self.history_calls.append((token, interval, oi, continuous))
        if continuous:
            return continuous_history()
        return [{"date": dt.datetime(2026, 11, 18), "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 9, "oi": 900},
                {"date": dt.datetime(2026, 11, 19), "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0, "volume": 9, "oi": 1000}]


class Patched(TestCase):
    def setUp(self):
        for target in ("backend.commodities.get_master_contract", "backend.commodity_home.get_master_contract", "backend.market_contracts.get_master_contract"):
            patcher = patch(target, return_value=frame())
            patcher.start()
            self.addCleanup(patcher.stop)
        today = patch("backend.market_contracts.market_today", return_value=FRIDAY)
        today.start()
        self.addCleanup(today.stop)

    def broker(self, kite):
        patchers = [patch(f"backend.{module}.broker", return_value=(kite, "session")) for module in ("commodities", "commodity_home")]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)


class SessionAndContractTests(Patched):
    def test_mcx_hours_follow_us_daylight_saving(self):
        self.assertEqual(mcx_session(at(23, 45)), {"open": True, "opensAt": "09:00", "closesAt": "23:55"})  # US winter
        self.assertEqual(mcx_session(at(23, 45, dt.date(2026, 7, 15)))["closesAt"], "23:30")  # US summer
        self.assertFalse(mcx_session(at(23, 45, dt.date(2026, 7, 15)))["open"])
        self.assertFalse(mcx_session(at(8, 59))["open"])
        self.assertFalse(mcx_session(at(12, 0, dt.date(2026, 11, 21)))["open"])  # Saturday

    def test_near_and_next_skip_expired_and_other_exchanges(self):
        near, upcoming = contracts(frame(), FRIDAY, "near"), contracts(frame(), FRIDAY, "next")
        self.assertEqual(near["CRUDEOIL"]["tradingsymbol"], "CRUDEOIL26DECFUT")
        self.assertEqual(upcoming["CRUDEOIL"]["tradingsymbol"], "CRUDEOIL27JANFUT")
        self.assertNotIn("SILVER", upcoming)
        rows = contract_rows()
        self.assertEqual([rows[(month, "crudeoil")]["tradingsymbol"] for month in ("current", "next", "far")],
                         ["CRUDEOIL26DECFUT", "CRUDEOIL27JANFUT", "CRUDEOIL27FEBFUT"])
        self.assertEqual(rows[("current", "crudeoil")]["exchange"], "MCX")


class BoardTests(Patched):
    def test_every_commodity_grouped_with_build_up_against_yesterdays_oi(self):
        UniverseStats.objects.create(symbol="MCX:CRUDEOIL26DECFUT", stats_on=FRIDAY, recent=[["2026-11-19", 5400, 5500, 5350, 5450, 9]],
                                     fut_oi={"2026-11-19": 10000})
        self.broker(FakeKite({"MCX:CRUDEOIL26DECFUT": kite_quote(5500, 5450, oi=11000, vwap=5480),
                              "MCX:GOLD26DECFUT": kite_quote(98000, 98500, oi=500)}))
        data = commodities_payload("near", at(14, 30))
        rows = {row["name"]: row for row in data["rows"]}
        crude = rows["CRUDEOIL"]
        self.assertEqual((crude["label"], crude["group"], crude["unit"], crude["daysToExpiry"]), ("Crude Oil", "Energy", "₹/bbl", 28))
        self.assertEqual((crude["change"], crude["oiChange"], crude["oiChangePct"], crude["buildup"]), (50, 1000, 10.0, "LB"))
        self.assertEqual((crude["prevHigh"], crude["bid"], crude["ask"]), (5500, 5499, 5501))
        self.assertEqual(rows["GOLD"]["buildup"], None)  # no OI baseline yet
        self.assertEqual([row["group"] for row in data["rows"]][:4], ["Bullion", "Bullion", "Energy", "Energy"])
        self.assertTrue(data["session"]["open"])


class HomeTests(Patched):
    def record(self, key, symbol, prices, start=(13, 30)):
        moment = dt.datetime.combine(FRIDAY, dt.time(*start))
        for step, price in enumerate(prices):
            MarketSnapshot.objects.create(index_key=key, contract_month="current", symbol=symbol, bucket_time=moment + dt.timedelta(minutes=5 * step),
                                          index_level=price, net_lots=50, vwap=prices[0])

    def test_cards_follow_the_index_rules_with_futures_positions_as_big_players(self):
        self.record("crudeoil", "CRUDEOIL26DECFUT", [5400, 5420, 5440, 5460, 5480, 5490, 5500, 5505])
        self.record("gold", "GOLD26DECFUT", [98600, 98580, 98550, 98520, 98500, 98480, 98460, 98450])
        UniverseStats.objects.create(symbol="MCX:CRUDEOIL26DECFUT", stats_on=FRIDAY, recent=[], fut_oi={"2026-11-19": 10000})
        UniverseStats.objects.create(symbol="MCX:GOLD26DECFUT", stats_on=FRIDAY, recent=[], fut_oi={"2026-11-19": 400})
        self.broker(FakeKite({"MCX:CRUDEOIL26DECFUT": kite_quote(5510, 5450, oi=11000, buy=900, sell=300, vwap=5460),
                              "MCX:GOLD26DECFUT": kite_quote(98200, 98700, oi=500, buy=100, sell=700, vwap=98550)}))
        with patch("backend.commodity_home.cached_broker_result", side_effect=lambda cache, session, keys, ttl, fetch:
                   {key: {"at": at(14, 30).timestamp(), "data": value} for key, value in fetch(keys).items()}), \
                patch("backend.commodity_home.cache_retry_ms", return_value=None):
            data = commodity_home_payload(at(14, 30))
        cards = {card["key"]: card for card in data["cards"]}
        self.assertEqual(list(cards), ["crudeoil", "naturalgas", "gold", "silver", "copper", "zinc"])
        crude = cards["crudeoil"]
        self.assertEqual((crude["label"], crude["price"], crude["change"]["value"], crude["change"]["since"]), ("CRUDE OIL", 5510, 60, "yesterday"))
        self.assertEqual((crude["direction"]["code"], crude["bigPlayers"]["code"], crude["light"]["color"]), ("up", "buying", "green"))
        self.assertEqual((crude["numbers"]["netLots"], crude["numbers"]["buildup"], crude["numbers"]["oiChangePct"]), (600, "LB", 10.0))
        self.assertIn("long build-up", crude["bigPlayers"]["detail"])
        gold = cards["gold"]
        self.assertEqual((gold["direction"]["code"], gold["bigPlayers"]["code"], gold["light"]["color"]), ("down", "selling", "green"))
        self.assertEqual(cards["naturalgas"]["bigPlayers"]["code"], "mixed")  # no data yet
        self.assertEqual(data["calendar"]["crudeoil"][0], {"date": "2026-12-18", "label": "Fri 18 Dec", "thisWeek": False})
        self.assertTrue(any("US markets open at 20:00 IST" in item["text"] for item in data["mustKnow"]))
        self.assertEqual((data["market"], data["marketOpen"], data["optionCost"]), ("commodity", True, None))
        self.assertIn("Commodity futures trading", data["disclaimer"])

    def test_futures_players_flag_disagreement_and_closed_market(self):
        self.assertEqual(futures_players("LB", 4.0, -300)["code"], "mixed")
        self.assertEqual(futures_players("SC", -2.0, 120)["code"], "buying")
        self.assertEqual(futures_players(None, None, None)["detail"], "No position data yet today.")
        self.broker(None)
        with patch("backend.commodity_home.broker", return_value=(None, None)):
            data = commodity_home_payload(at(7, 0))
        self.assertFalse(data["marketOpen"])
        self.assertTrue(all(card["light"]["color"] == "grey" for card in data["cards"]))
        self.assertEqual(data["mustKnow"][0]["text"], "MCX is closed. Cards show the last trading session. It opens at 09:00.")
        self.assertIn("not connected", data["message"])


class RecorderAndOverviewTests(Patched):
    def test_snapshots_record_net_lots_every_five_minutes_while_mcx_trades(self):
        kite = FakeKite({"MCX:CRUDEOIL26DECFUT": kite_quote(5500, 5450, buy=900, sell=300, vwap=5470),
                         "MCX:GOLD26DECFUT": kite_quote(98000, 98500, buy=100, sell=400, vwap=98200)})
        self.assertEqual(record_commodity_snapshot(kite, at(8, 30)), 0)
        self.assertEqual(record_commodity_snapshot(kite, at(21, 7)), 2)
        crude = MarketSnapshot.objects.get(index_key="crudeoil")
        self.assertEqual((crude.contract_month, crude.symbol, crude.net_lots, crude.demand_supply_ratio, crude.bucket_time.hour, crude.bucket_time.minute),
                         ("current", "CRUDEOIL26DECFUT", 600, 3.0, 21, 5))
        self.assertEqual(history_payload("crudeoil", "current")["points"][0]["netLots"], 600)
        self.assertIn("first five minutes", history_payload("gold", "next")["message"])

    def test_overview_lists_current_next_and_far_with_the_order_book(self):
        self.broker(FakeKite({"MCX:CRUDEOIL27JANFUT": kite_quote(5520, 5470, oi=3000, buy=50, sell=200, vwap=5500)}))
        data = overview_payload(at(14, 30))
        crude = next(item for item in data["commodities"] if item["key"] == "crudeoil")
        self.assertEqual([month["month"] for month in crude["months"]], ["current", "next", "far"])
        upcoming = crude["months"][1]
        self.assertEqual((upcoming["symbol"], upcoming["netLots"], upcoming["demandSupply"], upcoming["change"]), ("CRUDEOIL27JANFUT", -150, 0.25, 50))

    def test_daily_stats_store_previous_open_interest_once(self):
        kite = FakeKite({})
        with patch("backend.commodities.time.sleep"):
            saved = refresh_commodity_stats(kite, at(8, 0))
            self.assertEqual(refresh_commodity_stats(kite, at(8, 5)), 0)
        contract_count = len(contracts(frame(), FRIDAY, "near")) + len(contracts(frame(), FRIDAY, "next"))
        self.assertEqual(saved, contract_count + 6)  # plus a year of continuous history for the six headline commodities
        self.assertEqual(UniverseStats.objects.get(symbol="MCX:CRUDEOIL26DECFUT").fut_oi, {"2026-11-18": 900, "2026-11-19": 1000})
        self.assertTrue(all(call[1] == "day" for call in kite.history_calls))
        self.assertEqual(sum(1 for call in kite.history_calls if call[3]), 6)
        crude = UniverseStats.objects.get(symbol="MCXC:CRUDEOIL")
        self.assertEqual((len(crude.recent), crude.fut_symbol), (60, "CRUDEOIL26DECFUT"))


class EndpointTests(Patched):
    def setUp(self):
        super().setUp()
        user = User(username="commodity-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_need_login_and_valid_choices(self):
        for route in ("/api/commodities/", "/api/commodities/home/", "/api/commodities/overview/", "/api/commodities/history/", "/api/commodities/candles/"):
            self.assertEqual(self.client.get(route).json()["type"], "TokenException")
        self.assertEqual(self.client.get("/api/commodities/", {"month": "far"}, **self.headers).status_code, 400)
        self.assertEqual(self.client.get("/api/commodities/history/", {"key": "wheat"}, **self.headers).status_code, 400)
        self.assertEqual(self.client.get("/api/commodities/candles/", {"symbol": "CRUDEOIL26DECFUT", "interval": "2minute"}, **self.headers).status_code, 400)
        self.broker(None)
        with patch("backend.commodities.broker", return_value=(None, None)):
            self.assertEqual(self.client.get("/api/commodities/candles/", {"symbol": "NOTREAL"}, **self.headers).status_code, 400)
            data = self.client.get("/api/commodities/", **self.headers).json()
        self.assertEqual((data["type"], len(data["rows"])), ("success", 7))
        self.assertIn("not connected", data["message"])


def stored_history(symbol, rows):
    UniverseStats.objects.create(symbol=symbol, stats_on=FRIDAY, recent=[[row["date"].date().isoformat(), row["open"], row["high"], row["low"],
                                                                          row["close"], row["volume"]] for row in rows], fut_oi={})


class MathTests(TestCase):
    def candles(self, **kwargs):
        return [[row["date"].date().isoformat(), row["open"], row["high"], row["low"], row["close"], row["volume"]] for row in continuous_history(**kwargs)]

    def test_volatility_range_and_trend_by_hand(self):
        flat = [["2026-11-0%d" % i, 100, 101, 99, 100, 1] for i in range(1, 9)]
        self.assertEqual(cm.daily_volatility(flat), 0.0)
        self.assertEqual(cm.average_true_range(flat), 2.0)
        self.assertIsNone(cm.daily_volatility(flat[:3]))
        candles = self.candles()
        self.assertEqual(cm.average_true_range(candles), 40.0)
        self.assertEqual(cm.moving_average(candles, 20), 5000 + 5 * (59 + 40) / 2)
        levels = cm.pivots(candles[-1])
        self.assertAlmostEqual(levels["P"], 5295.0)
        self.assertAlmostEqual(levels["R1"], 5295 * 2 - 5275)
        expected = cm.expected_range("CRUDE OIL", 5000, 0.02, 5010, levels)
        self.assertEqual((expected["low"], expected["high"], expected["iv"], expected["basis"]), (4901, 5101, 31.7, "realized"))
        self.assertIn("between 4,901 and 5,101 today", expected["text"])
        trend = cm.trend(candles, 5400)
        self.assertEqual((trend["aboveSma20"], trend["aboveSma50"], trend["high52"]), (True, True, 5315))
        self.assertTrue(trend["read"].startswith("Uptrend"))
        self.assertTrue(cm.trend(candles, 4000)["read"].startswith("Downtrend"))
        volatility, _ = cm.volatility(candles, 5330, 5300, 5320)
        self.assertEqual((volatility["atr"], volatility["rangeUsedPct"]), (40.0, 75))
        self.assertIn("little room left", volatility["read"])

    def test_term_structure_rollover_lots_and_ratios(self):
        contango = cm.term_structure(5000, 5050, 5090, 10, 40)
        self.assertEqual((contango["state"], contango["spread"], contango["spreadPct"], contango["carryAnnualPct"], contango["farSpread"]),
                         ("contango", 50, 1.0, 12.2, 90))
        self.assertEqual(cm.term_structure(5000, 4950, None, 10, 40)["state"], "backwardation")
        self.assertIsNone(cm.term_structure(5000, None, None, 10, 40)["state"])
        self.assertEqual(cm.rollover(3000, 6000, 1000, 3)["rolloverPct"], 70.0)
        self.assertIn("Expiry in 3 days", cm.rollover(3000, 6000, 1000, 3)["read"])
        self.assertEqual(cm.per_lot("CRUDEOIL", 5500, 60, 80), {"lot": "100 barrels", "perPoint": 100, "contractValue": 550000, "todayPerLot": 6000, "atrPerLot": 8000})
        self.assertEqual(cm.per_lot("GOLD", 98000, -500, 900)["todayPerLot"], -50000)
        self.assertIsNone(cm.per_lot("CARDAMOM", 1, 1, 1))
        gold = [["2026-11-%02d" % d, 0, 0, 0, 98000, 0] for d in range(1, 21)]
        silver = [["2026-11-%02d" % d, 0, 0, 0, 118000, 0] for d in range(1, 21)]
        ratio = cm.gold_silver_ratio(100000, 115000, gold, silver)
        self.assertEqual((ratio["ratio"], ratio["average20"]), (86.96, 83.05))
        self.assertIn("silver is cheap", ratio["read"])
        self.assertIn("Copper beating gold by 1.00%", cm.relative_strength(1.2, 0.2, "Copper", "gold", "risk-on.", "risk-off.")["read"])
        self.assertIn("Rupee weaker by 0.21%", cm.rupee_effect(94.3, 0.21)["read"])


class InsightTests(Patched):
    def test_insights_and_card_range_from_continuous_history(self):
        stored_history("MCXC:CRUDEOIL", continuous_history(start=dt.date(2026, 8, 24), base=5000, step=5))
        stored_history("MCXC:GOLD", continuous_history(start=dt.date(2026, 8, 24), base=97000, step=10))
        stored_history("MCXC:SILVER", continuous_history(start=dt.date(2026, 8, 24), base=117000, step=10))
        UniverseStats.objects.create(symbol="MCX:CRUDEOIL26DECFUT", stats_on=FRIDAY, recent=[], fut_oi={"2026-11-19": 10000})
        kite = FakeKite({"MCX:CRUDEOIL26DECFUT": kite_quote(5330, 5300, oi=11000, buy=900, sell=300, vwap=5320),
                         "MCX:CRUDEOIL27JANFUT": kite_quote(5360, 5330, oi=6000), "MCX:CRUDEOIL27FEBFUT": kite_quote(5390, 5360, oi=3000),
                         "MCX:GOLD26DECFUT": kite_quote(98000, 98500), "MCX:SILVER26DECFUT": kite_quote(115000, 114000),
                         "CDS:USDINR26NOVFUT": kite_quote(94.3, 94.1)})
        self.broker(kite)
        direct = lambda cache, session, keys, ttl, fetch: {key: {"at": at(14, 30).timestamp(), "data": value} for key, value in fetch(keys).items()}
        with patch("backend.commodity_home.cached_broker_result", side_effect=direct), patch("backend.commodity_home.cache_retry_ms", return_value=None), \
                patch("backend.commodity_home.instrument", return_value="CDS:USDINR26NOVFUT"):
            data = insights_payload(at(14, 30))
            home = commodity_home_payload(at(14, 30))
        crude = next(item for item in data["items"] if item["key"] == "crudeoil")
        self.assertEqual((crude["sessions"], crude["volatility"]["atr"], crude["volatility"]["rangeUsedPct"]), (60, 40.0, 75))
        self.assertEqual((crude["term"]["state"], crude["term"]["spread"], crude["term"]["rolloverPct"]), ("contango", 30, 45.0))
        self.assertEqual((crude["positions"]["oiChangePct"], crude["positions"]["buildup"]), (10.0, "LB"))
        self.assertEqual((crude["lot"]["perPoint"], crude["lot"]["todayPerLot"], crude["lot"]["atrPerLot"]), (100, 3000, 4000))
        self.assertTrue(crude["trend"]["aboveSma20"])
        self.assertEqual(crude["levels"]["P"], 5295.0)
        self.assertEqual(crude["range"]["support"], crude["levels"]["S1"])
        cross = data["cross"]
        self.assertEqual(cross["goldSilver"]["ratio"], round(98000 * 100 / 115000, 2))
        self.assertIn("Rupee weaker", cross["rupee"]["read"])
        self.assertIn("lagging", cross["copperGold"]["read"] if cross["copperGold"] else "lagging")
        card = next(card for card in home["cards"] if card["key"] == "crudeoil")
        self.assertEqual((card["range"]["basis"], card["range"]["support"]), ("realized", crude["levels"]["S1"]))
        self.assertIsNone(next(card for card in home["cards"] if card["key"] == "zinc")["range"])  # no history yet

    def test_insights_endpoint_needs_login(self):
        self.assertEqual(self.client.get("/api/commodities/insights/").json()["type"], "TokenException")

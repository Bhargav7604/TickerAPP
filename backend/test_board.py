import datetime as dt
import json
import os
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
from django.test import TestCase
from django.utils import timezone

from .board_jobs import maintain_board
from .board_signals import ema, group_bars, indicators, rsi, sector_flow, supertrend, trade_plan
from .board_tracker import SCANNER_IDS, SNAPSHOT_ID, BoardTracker, minute_of
from .board_universe import build_universe, previous_candle, previous_oi, refresh_universe_stats, summarise_candles
from .live_feed import SharedMarketFeed
from .market_contracts import MARKET_TZ
from .models import KiteSettings, LiveMarketFeed, UniverseStats, User
from .test_security_feed import instrument_frame

MONDAY = dt.date(2026, 11, 16)


def at(hour, minute, second=0, day=MONDAY):
    return dt.datetime.combine(day, dt.time(hour, minute, second), tzinfo=MARKET_TZ)


def frame():
    rows = [
        (11, "RELIANCE", "RELIANCE INDUSTRIES", None, 1, "EQ", "NSE", "NSE", False),
        (12, "EMBASSY-RR", "EMBASSY OFFICE PARKS", None, 1, "EQ", "NSE", "NSE", False),
        (13, "ANGELONE", "ANGEL ONE", None, 1, "EQ", "NSE", "NSE", False),
        (14, "TCS", "TATA CONSULTANCY", None, 1, "EQ", "NSE", "NSE", False),
        (99, "RELIANCE26OCTFUT", "RELIANCE", "2026-10-27", 500, "FUT", "NFO-FUT", "NFO", True),
        (101, "RELIANCE26NOVFUT", "RELIANCE", "2026-11-24", 500, "FUT", "NFO-FUT", "NFO", True),
        (102, "RELIANCE26DECFUT", "RELIANCE", "2026-12-29", 500, "FUT", "NFO-FUT", "NFO", True),
        (103, "ANGELONE26NOVFUT", "ANGELONE", "2026-11-24", 250, "FUT", "NFO-FUT", "NFO", True),
        (256265, "NIFTY 50", "NIFTY 50", None, 0, "EQ", "INDICES", "NSE", False),
        (264969, "INDIA VIX", "INDIA VIX", None, 0, "EQ", "INDICES", "NSE", False),
        (265, "SENSEX", "SENSEX", None, 0, "EQ", "INDICES", "BSE", False),
    ]
    return pd.DataFrame([{"instrument_token": token, "tradingsymbol": symbol, "name": name,
                          "expiry": pd.Timestamp(expiry) if expiry else pd.NaT, "lot_size": lot, "instrument_type": kind,
                          "segment": segment, "exchange": exchange, "stock_derivative": derivative}
                         for token, symbol, name, expiry, lot, kind, segment, exchange, derivative in rows])


MEMBERS = {
    "nifty500": {"RELIANCE": ("Reliance Industries Ltd.", "Oil & Gas", "EQ"), "EMBASSY": ("Embassy REIT", "Realty", "RR"),
                 "TCS": ("Tata Consultancy Services Ltd.", "IT", "EQ")},
    "nifty100": {"RELIANCE": (), "TCS": ()}, "nifty": {"RELIANCE": ()}, "sensex": {"RELIANCE": (), "TCS": ()},
}


def tick(token, price, volume=None, close=None, oi=None, average=None):
    data = {"instrument_token": token, "last_price": price, "ohlc": {"open": 100, "high": 102, "low": 99, "close": close or 99}}
    if volume is not None:
        data["volume_traded"] = volume
    if oi is not None:
        data["oi"] = oi
    if average is not None:
        data["average_traded_price"] = average
    return data


class SignalTests(TestCase):
    def test_averages_rsi_and_supertrend(self):
        self.assertEqual(ema([1, 2, 3, 4, 5], 3), [None, None, 2.0, 3.0, 4.0])
        self.assertEqual(ema([1, 2], 3), [])
        self.assertEqual(rsi(list(range(1, 20))), 100.0)
        self.assertIsNone(rsi([1, 2, 3]))
        falling = [100 - i * 0.5 + (0.2 if i % 2 else 0) for i in range(30)]
        self.assertLess(rsi(falling), 45)
        rising = [[100 + i, 101 + i, 99.5 + i, 100.8 + i] for i in range(20)]
        direction, line, atr = supertrend(rising)
        self.assertEqual(direction, 1)
        self.assertLess(line, rising[-1][3])
        self.assertGreater(atr, 0)
        self.assertEqual(group_bars([(0, 1, 2, 0.5, 1.5, 10, 0), (1, 1.5, 3, 1, 2, 5, 0), (3, 2, 2.5, 1.8, 2.2, 1, 0)], 3),
                         [[1, 3, 0.5, 2], [2, 2.5, 1.8, 2.2]])

    def test_a_steady_rise_reads_long_with_a_bounded_stop(self):
        bars = [(m, 100 + m * 0.1, 100.15 + m * 0.1, 99.95 + m * 0.1, 100.1 + m * 0.1, 1000, 0) for m in range(90)]
        stock = {"ltp": 109.1, "prev": 100, "high": 109.2, "low": 99.95, "vwap": 104.5, "prevH": 101, "prevL": 98, "volume": 90000,
                 "avgVol": 50000, "oi": 1100, "prevOi": 1000, "sector": "IT"}
        checks, trend = indicators(stock, bars, 1, 89, 0.4, {"IT": ("acc", 20)})
        three_minute, _ = indicators(stock, bars, 3, 89, 0.4, {"IT": ("acc", 20)})
        self.assertNotIn("macd", three_minute)  # 30 three-minute bars; MACD needs 35
        self.assertEqual(set(checks), {"vwap", "ema", "st", "rsi", "macd", "orb", "cpr", "pdhl", "vol", "oi", "rs", "dr", "sec"})
        self.assertTrue(all(value[0] == 1 for value in checks.values()), checks)
        self.assertEqual(checks["oi"][1], "LB")
        plan = trade_plan(stock["ltp"], checks, trend)
        self.assertEqual((plan["side"], plan["bull"], plan["avail"]), (1, 13, 13))
        self.assertTrue(109.1 * 0.98 <= plan["stop"] <= 109.1 * 0.997)
        self.assertAlmostEqual(plan["target"], 109.1 + 2 * (109.1 - plan["stop"]), places=1)
        # Before 09:30 the opening range is not set yet.
        early, _ = indicators(stock, bars[:10], 1, 9, 0.4, {})
        self.assertNotIn("orb", early)

    def test_sector_verdicts_follow_flow_vwap_and_build_up(self):
        stocks = [
            {"symbol": "A", "sector": "IT", "ltp": 102, "prev": 100, "vwap": 101, "flow": 5e8, "flow30": 2e8, "value": 9e8, "oi": 110, "prevOi": 100},
            {"symbol": "B", "sector": "IT", "ltp": 101, "prev": 100, "vwap": 100.5, "flow": 2e8, "flow30": 1e8, "value": 4e8},
            {"symbol": "C", "sector": "Banks", "ltp": 97, "prev": 100, "vwap": 98, "flow": -6e8, "flow30": -3e8, "value": 8e8, "oi": 120, "prevOi": 100},
        ]
        rows = sector_flow(stocks)
        self.assertEqual([(row["sector"], row["tag"]) for row in rows], [("IT", "in"), ("Banks", "out")])
        self.assertEqual((rows[0]["flow"], rows[0]["lb"], rows[0]["aboveVwapPct"], rows[0]["best"]), (70.0, 1, 100, ("A", 2.0)))


class UniverseTests(TestCase):
    def test_nifty500_and_fno_stocks_with_flags_caps_and_nearest_future(self):
        stocks, indices = build_universe(frame(), MEMBERS, MONDAY)
        by = {stock["symbol"]: stock for stock in stocks}
        self.assertEqual(list(by), ["ANGELONE", "EMBASSY", "RELIANCE", "TCS"])
        self.assertEqual((by["RELIANCE"]["flags"], by["RELIANCE"]["cap"], by["RELIANCE"]["fut"]),
                         (15, "Large", {"symbol": "RELIANCE26NOVFUT", "token": 101, "lot": 500, "expiry": "2026-11-24"}))
        self.assertEqual((by["ANGELONE"]["flags"], by["ANGELONE"]["sector"], by["ANGELONE"]["cap"]), (2, "Other", ""))
        self.assertEqual((by["EMBASSY"]["quoteSymbol"], by["EMBASSY"]["cap"], by["TCS"]["flags"]), ("EMBASSY-RR", "Small", 9))
        self.assertEqual([index["key"] for index in indices], ["NIFTY", "SENSEX", "INDIAVIX"])

    def test_daily_stats_leave_out_today_and_stop_when_the_session_expires(self):
        today = MONDAY
        candles = [{"date": dt.datetime.combine(today - dt.timedelta(days=day), dt.time()), "open": 100, "high": 100 + day,
                    "low": 90 - day, "close": 95, "volume": 1000 * day} for day in range(30, -1, -1)]
        stats = summarise_candles(candles, today)
        self.assertEqual((stats["high_52w"], stats["low_52w"]), (130, 60))
        self.assertEqual(stats["avg_volume"], sum(1000 * day for day in range(1, 21)) / 20)
        self.assertEqual(stats["recent"][-1][0], today.isoformat())
        self.assertEqual(previous_candle(stats["recent"], today)[0], (today - dt.timedelta(days=1)).isoformat())
        self.assertEqual(previous_oi({"2026-11-13": 4000, "2026-11-16": 4500}, today), 4000)

        class TokenException(Exception):
            pass

        client = Mock()
        client.historical_data.side_effect = lambda token, start, end, interval, oi=False: (
            [{"date": dt.datetime(2026, 11, 13), "oi": 4000}] if oi else candles)
        with patch("backend.board_universe.universe", return_value=build_universe(frame(), MEMBERS, today)):
            self.assertEqual(refresh_universe_stats(client, at(8, 0), pause=0), 7)
            self.assertEqual(UniverseStats.objects.get(symbol="RELIANCE").fut_oi, {"2026-11-13": 4000})
            self.assertEqual(refresh_universe_stats(client, at(8, 5), pause=0), 0)  # already done today
            UniverseStats.objects.all().delete()
            client.historical_data.side_effect = TokenException("expired")
            self.assertEqual(refresh_universe_stats(client, at(8, 10), pause=0), 0)
            self.assertEqual(client.historical_data.call_count, 1 + 9)


class TrackerTests(TestCase):
    def setUp(self):
        universe = patch("backend.board_tracker.universe", return_value=build_universe(frame(), MEMBERS, MONDAY))
        universe.start()
        self.addCleanup(universe.stop)
        self.tracker = BoardTracker()
        self.tokens = self.tracker.configure(at(9, 0))

    def test_subscribes_futures_in_full_mode_and_the_rest_in_quote_mode(self):
        self.assertEqual(self.tokens[101], "full")
        self.assertEqual((self.tokens[11], self.tokens[256265]), ("quote", "quote"))
        self.assertNotIn(102, self.tokens)

    def test_money_flow_adds_up_ticks_and_minute_bars(self):
        self.assertEqual(minute_of(at(9, 20, 5)), 5)
        self.assertEqual(minute_of(at(9, 1)), 0)
        self.tracker.on_ticks([tick(11, 100, 1000, average=100.4)], at(9, 20, 5))
        self.tracker.on_ticks([tick(11, 101, 1100), tick(101, 101.5, oi=5000), tick(256265, 22600, close=22500)], at(9, 20, 30))
        self.tracker.on_ticks([tick(11, 100.5, 1300)], at(9, 21, 10))
        self.tracker.on_ticks([tick(11, 100.5, 1350)], at(9, 21, 20))  # same price keeps the last direction
        state = self.tracker.state["RELIANCE"]
        self.assertEqual(state.flow, 100 * 101 - 200 * 100.5 - 50 * 100.5)
        self.assertEqual(state.bars, {5: [100, 101, 100, 101, 100, 10100], 6: [100.5, 100.5, 100.5, 100.5, 250, -25125.0]})
        UniverseStats.objects.create(symbol="RELIANCE", stats_on=MONDAY, avg_volume=5e6, high_52w=110, low_52w=80,
                                     recent=[["2026-11-12", 1, 2, 1, 2, 9], ["2026-11-13", 100, 105, 98, 99, 9], ["2026-11-16", 1, 1, 1, 1, 1]],
                                     fut_symbol="RELIANCE26NOVFUT", fut_oi={"2026-11-13": 4000})
        with patch("backend.board_tracker.time.time", return_value=time.time()):
            data = self.tracker.snapshot(at(9, 21, 30))
        row = dict(zip(data["fields"], data["rows"][0]))
        self.assertEqual((data["status"], data["session"], data["minute"]), ("live", "2026-11-16", 6))
        self.assertEqual((row["sym"], row["flow"], row["flow30"], row["p30"], row["oi"], row["prevOi"], row["prevH"], row["prevL"]),
                         ("RELIANCE", -15025, -15025, None, 5000, 4000, 105, 98))
        self.assertEqual((row["vwap"], row["prev"], row["lot"], row["flags"]), (100.4, 99, 500, 15))
        self.assertEqual(data["indices"][0]["ltp"], 22600)
        # The next morning starts clean.
        self.tracker.on_ticks([tick(11, 102, 50)], at(9, 16, day=MONDAY + dt.timedelta(days=1)))
        self.assertEqual((self.tracker.state["RELIANCE"].flow, list(self.tracker.state["RELIANCE"].bars)), (0.0, [1]))

    def test_seed_fills_quiet_stocks_and_circuits_without_overwriting_live_ticks(self):
        self.tracker.on_ticks([tick(11, 100, 1000)], at(9, 20))
        traded = dt.datetime(2026, 11, 16, 9, 20)
        client = Mock()
        client.quote.return_value = {
            "NSE:RELIANCE": {"last_price": 50, "ohlc": {"close": 49}, "lower_circuit_limit": 90, "upper_circuit_limit": 110, "last_trade_time": traded},
            "NSE:TCS": {"last_price": 4000, "ohlc": {"open": 3990, "high": 4010, "low": 3980, "close": 3950}, "volume": 77,
                        "average_price": 4001, "lower_circuit_limit": 3555, "upper_circuit_limit": 4345, "last_trade_time": traded},
            "NFO:ANGELONE26NOVFUT": {"last_price": 2500, "oi": 777},
        }
        self.assertEqual(self.tracker.seed(client, at(9, 20, 30), pause=0), 3)
        self.assertEqual(client.quote.call_count, 1)
        reliance, tcs = self.tracker.state["RELIANCE"], self.tracker.state["TCS"]
        self.assertEqual((reliance.ltp, reliance.lc, reliance.uc), (100, 90, 110))
        self.assertEqual((tcs.ltp, tcs.prev, tcs.vwap, tcs.volume, tcs.uc), (4000, 3950, 4001, 77, 4345))
        self.assertEqual((self.tracker.state["ANGELONE"].oi, self.tracker.circuits_on, self.tracker.session), (777, MONDAY, MONDAY))

    def test_backfill_fills_only_minutes_before_live_ticks(self):
        self.tracker.on_ticks([tick(11, 100, 1000)], at(9, 20, 5))
        self.tracker.on_ticks([tick(11, 101, 1100)], at(9, 20, 30))
        history = [{"date": dt.datetime(2026, 11, 16, 9, 15 + m), "open": 99, "high": 99.5, "low": 98.5, "close": 99 + m * 0.1, "volume": 10}
                   for m in range(8)]
        client = Mock()
        client.historical_data.return_value = history
        self.assertEqual(self.tracker.backfill(client, at(9, 23), pause=0), 4)  # TCS, ANGELONE, EMBASSY have not ticked yet
        bars = self.tracker.state["RELIANCE"].bars
        self.assertEqual(sorted(bars), [0, 1, 2, 3, 4, 5])
        self.assertEqual(bars[5][4], 100)  # the live minute is kept
        self.assertEqual(bars[1][5], 10 * 99.1)
        self.assertTrue(all(state.backfilled for state in self.tracker.state.values()))
        self.assertEqual(self.tracker.backfill(client, at(9, 24), pause=0), 0)

    def test_scanner_and_snapshot_are_published_for_the_web(self):
        for m in range(40):
            self.tracker.on_ticks([tick(11, 100 + m * 0.05, 1000 + m * 100, average=100.5)], at(9, 15 + m, 10))
        self.tracker.publish_snapshot(at(9, 55), force=True)
        self.assertEqual(self.tracker.publish_scanner(at(9, 55)), 3)
        snapshot = LiveMarketFeed.objects.get(pk=SNAPSHOT_ID).payload
        self.assertEqual(snapshot["rows"][0][0], "RELIANCE")
        scanner = LiveMarketFeed.objects.get(pk=SCANNER_IDS[3]).payload
        symbol, sides, details, stop, target = scanner["rows"][0]
        self.assertEqual((symbol, len(sides), scanner["bars"]), ("RELIANCE", 13, 3))
        self.assertEqual(sides[0], "+")  # above VWAP
        self.assertIn("vwap", details)
        self.assertEqual(self.tracker.extras["sectorFlow"][0]["sector"], "Oil & Gas")


class JobTests(TestCase):
    def test_upkeep_seeds_once_a_day_then_fills_gaps_and_stats(self):
        tracker = Mock(stocks=[{"symbol": "X"}], seeded_on=None, circuits_on=None)
        client = Mock()
        with patch("backend.board_jobs.refresh_universe_stats", return_value=5) as stats:
            done = maintain_board(tracker, client, at(9, 30))
        tracker.seed.assert_called_once()
        tracker.backfill.assert_called_once()
        stats.assert_called_once()
        self.assertEqual(done["stats"], 5)
        tracker.seed.reset_mock()
        tracker.seeded_on = tracker.circuits_on = MONDAY
        with patch("backend.board_jobs.refresh_universe_stats", return_value=0):
            maintain_board(tracker, client, at(9, 31))
        tracker.seed.assert_not_called()


class FeedTests(TestCase):
    def test_board_tokens_join_the_shared_connection_and_receive_ticks(self):
        KiteSettings.objects.create(api_key="dummy-key", api_secret="dummy-secret", access_token="dummy-token")
        tracker = Mock()
        tracker.configure.return_value = {900: "quote", 901: "full"}
        feed = SharedMarketFeed(lambda callback: callback(), ticker_factory=lambda *a, **k: Mock(MODE_FULL="full", MODE_QUOTE="quote"),
                                tracker=tracker)
        with patch("backend.live_feed.get_master_contract", return_value=instrument_frame()):
            self.assertTrue(feed.renew_lease())
            feed.configure()
        ticker = feed.ticker
        feed.on_connect(ticker, {})
        subscribed = ticker.subscribe.call_args[0][0]
        self.assertIn(900, subscribed)
        modes = {call[0][0]: call[0][1] for call in ticker.set_mode.call_args_list}
        self.assertEqual(modes["quote"], [900])
        self.assertIn(901, modes["full"])
        feed.on_ticks(ticker, [{"instrument_token": 900, "last_price": 1}])
        tracker.on_ticks.assert_called_once()
        self.assertNotIn("900", feed.ticks)
        tracker.on_ticks.side_effect = RuntimeError("bad tick")
        feed.on_ticks(ticker, [{"instrument_token": 900, "last_price": 1}])  # never breaks the index feed


class UpdaterTests(TestCase):
    def test_master_contract_keeps_board_stocks_and_indices(self):
        from .master_contract_updater import fetch_master_contract
        from .models import IndexConstituent
        IndexConstituent.objects.all().delete()
        IndexConstituent.objects.create(index_key="nifty500", symbol="TCS", series="EQ")
        IndexConstituent.objects.create(index_key="nifty500", symbol="EMBASSY", series="RR")
        csv = frame().drop(columns=["stock_derivative"])
        csv = pd.concat([csv, pd.DataFrame([{"instrument_token": 15, "tradingsymbol": "TINYCO", "name": "TINY", "expiry": pd.NaT,
                                             "lot_size": 1, "instrument_type": "EQ", "segment": "NSE", "exchange": "NSE"}])])
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"MASTER_CONTRACT_PATH": os.path.join(folder, "mc.csv")}), \
                patch("backend.master_contract_updater.r.get", return_value=SimpleNamespace(text=csv.to_csv(index=False), raise_for_status=lambda: None)), \
                patch("backend.master_contract_updater.log"):
            fetch_master_contract()
            saved = pd.read_csv(os.path.join(folder, "mc.csv"))
        cash = set(saved[saved["segment"].eq("NSE")]["tradingsymbol"])
        self.assertEqual(cash, {"RELIANCE", "ANGELONE", "TCS", "EMBASSY-RR"})
        self.assertEqual(set(saved[saved["segment"].eq("INDICES")]["tradingsymbol"]), {"NIFTY 50", "INDIA VIX", "SENSEX"})


class EndpointTests(TestCase):
    def setUp(self):
        user = User(username="board-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}),
                                    content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_needs_login_and_serves_what_the_worker_published(self):
        self.assertEqual(self.client.get("/api/board/snapshot/").json()["type"], "TokenException")
        self.assertEqual(self.client.get("/api/board/scanner/").json()["type"], "TokenException")
        with patch("backend.board_views.get_master_contract", return_value=frame()):
            empty = self.client.get("/api/board/snapshot/", **self.headers).json()
        self.assertEqual((empty["status"], empty["rows"]), ("offline", []))
        self.assertIn("Zerodha", empty["message"])
        rows = [["S%03d" % i, "IT", "Large", 1, 100.0 + i] for i in range(60)]
        LiveMarketFeed.objects.create(pk=SNAPSHOT_ID, payload={"status": "live", "fields": ["sym"], "rows": rows, "indices": []})
        with patch("backend.board_views.get_master_contract", return_value=frame()):
            response = self.client.get("/api/board/snapshot/", HTTP_ACCEPT_ENCODING="gzip", **self.headers)
        self.assertEqual(response["Content-Encoding"], "gzip")
        with patch("backend.board_views.get_master_contract", return_value=frame()):
            data = self.client.get("/api/board/snapshot/", **self.headers).json()
        self.assertEqual((data["status"], len(data["rows"]), data["holidays"]["2026-11-24"]), ("live", 60, "Guru Nanak Jayanti"))
        LiveMarketFeed.objects.filter(pk=SNAPSHOT_ID).update(updated_at=timezone.now() - dt.timedelta(minutes=2))
        with patch("backend.board_views.get_master_contract", return_value=frame()):
            self.assertEqual(self.client.get("/api/board/snapshot/", **self.headers).json()["status"], "stale")
        self.assertEqual(self.client.get("/api/board/scanner/", {"bars": 2}, **self.headers).status_code, 400)
        self.assertIn("starts", self.client.get("/api/board/scanner/", {"bars": 5}, **self.headers).json()["message"])
        LiveMarketFeed.objects.create(pk=SCANNER_IDS[1], payload={"rows": [["X", "+" * 13, {}, 1, 2]], "bars": 1})
        self.assertEqual(self.client.get("/api/board/scanner/", {"bars": 1}, **self.headers).json()["rows"][0][0], "X")

    def test_stock_card_candles_only_for_board_stocks(self):
        self.assertEqual(self.client.get("/api/board/candles/", {"symbol": "RELIANCE"}).json()["type"], "TokenException")
        LiveMarketFeed.objects.create(pk=SNAPSHOT_ID, payload={"session": "2026-11-13"})
        client = Mock()
        client.historical_data.return_value = [{"date": dt.datetime(2026, 11, 13, 9, 15), "open": 1, "high": 2, "low": 0.5, "close": 1.5}]
        with patch("backend.board_views.universe", return_value=build_universe(frame(), MEMBERS, MONDAY)), \
                patch("backend.board_views.broker", return_value=(client, "session")):
            self.assertEqual(self.client.get("/api/board/candles/", {"symbol": "NOTREAL"}, **self.headers).status_code, 400)
            data = self.client.get("/api/board/candles/", {"symbol": "reliance"}, **self.headers).json()
        self.assertEqual((data["session"], data["candles"][0]["close"]), ("2026-11-13", 1.5))
        token, start, end, interval = client.historical_data.call_args[0]
        self.assertEqual((token, start, interval), (11, dt.datetime(2026, 11, 13, 9, 15), "3minute"))

    def test_expiry_calendar_comes_from_the_instrument_list(self):
        from .board_views import expiry_calendar
        options = pd.DataFrame([{"name": "NIFTY", "exchange": "NFO", "segment": "NFO-OPT", "expiry": pd.Timestamp(day), "lot_size": 65}
                                for day in ("2026-11-17", "2026-11-24", "2026-12-01")]
                               + [{"name": "BANKNIFTY", "exchange": "NFO", "segment": "NFO-OPT", "expiry": pd.Timestamp(day), "lot_size": 30}
                                  for day in ("2026-11-23", "2026-12-29")])
        rows = {row["index"]: row for row in expiry_calendar(options, MONDAY)}
        self.assertEqual((rows["NIFTY"]["cycle"], rows["NIFTY"]["lot"], rows["NIFTY"]["daysTo"]), ("Weekly", 65, 1))
        self.assertEqual((rows["BANKNIFTY"]["cycle"], rows["BANKNIFTY"]["next"][0]), ("Monthly", "2026-11-23"))

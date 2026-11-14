import datetime as dt
import json
from unittest.mock import patch

import pandas as pd
from django.test import TestCase

from .models import LiveMarketFeed, OptionOIBaseline, OptionOISnapshot, User
from .oi_analysis import buildup, chain_payload, implied_volatility, live_chain_payload, max_pain, option_delta, option_price, trend_payload
from . import oi_recorder
from .oi_recorder import bucket_for, record_option_oi, select_strikes

DAY = dt.date(2026, 10, 22)
EXPIRY = dt.date(2026, 10, 27)


def at(hour, minute):
    return dt.datetime.combine(DAY, dt.time(hour, minute))


def snap(time, strike, option_type, oi, ltp, underlying, prev_close=None):
    return OptionOISnapshot(index_key="nifty", expiry=EXPIRY, strike=strike, option_type=option_type, bucket_time=time,
                            underlying=underlying, oi=oi, ltp=ltp, prev_close=prev_close)


class OIMathTests(TestCase):
    def test_strike_window_centres_on_atm_and_keeps_recorded_strikes(self):
        strikes = [22000 + step * 50 for step in range(40)]
        selected = select_strikes(strikes, 22612, recorded=[22000], each_side=2)
        self.assertEqual(selected, [22000, 22500, 22550, 22600, 22650, 22700])

    def test_implied_volatility_recovers_the_pricing_volatility(self):
        years = 5 / 365
        for option_type in ("CE", "PE"):
            price = option_price(22600, 22650, years, 0.15, option_type)
            self.assertAlmostEqual(implied_volatility(price, 22600, 22650, years, option_type), 15.0, places=1)
        self.assertIsNone(implied_volatility(0.05, 22600, 22000, years, "CE"))

    def test_buildup_labels(self):
        self.assertEqual(buildup(5, 100), "Long Build-up")
        self.assertEqual(buildup(-5, 100), "Short Build-up")
        self.assertEqual(buildup(5, -100), "Short Covering")
        self.assertEqual(buildup(-5, -100), "Long Unwinding")
        self.assertIsNone(buildup(0, 100))

    def test_delta_and_max_pain(self):
        call = option_delta(22600, 22600, 7 / 365, "CE", 15)
        put = option_delta(22600, 22600, 7 / 365, "PE", 15)
        self.assertTrue(0.5 <= call <= 0.6)
        self.assertAlmostEqual(call - put, 1, places=1)
        self.assertEqual(option_delta(22600, 22000, 7 / 365, "CE", 15), 0.91)  # 2.7% in the money, a week out
        self.assertIsNone(option_delta(22600, 22600, 7 / 365, "CE", None))
        # Heavy call OI at 22700 and put OI at 22500 pin the cheapest expiry for buyers between them.
        oi = {(22500, "PE"): 9000, (22600, "PE"): 1000, (22600, "CE"): 1000, (22700, "CE"): 9000, (22500, "CE"): 500, (22700, "PE"): 500}
        self.assertEqual(max_pain(oi), 22600)
        self.assertIsNone(max_pain({}))

    def test_bucket_is_floored_to_three_minutes(self):
        self.assertEqual(bucket_for(dt.datetime(2026, 10, 22, 10, 5, 41)), dt.datetime(2026, 10, 22, 10, 3))


class OIAnalysisTests(TestCase):
    def setUp(self):
        rows = []
        for time, underlying, (call_oi, put_oi), (call_ltp, put_ltp) in [
            (at(9, 15), 22600, (1000, 1000), (100, 100)),
            (at(9, 18), 22650, (1500, 1200), (90, 110)),
            (at(9, 21), 22550, (1600, 2400), (95, 120)),
        ]:
            for strike in (22550, 22600, 22650):
                rows.append(snap(time, strike, "CE", call_oi, call_ltp, underlying, prev_close=80))
                rows.append(snap(time, strike, "PE", put_oi, put_ltp, underlying, prev_close=120))
        OptionOISnapshot.objects.bulk_create(rows)
        OptionOIBaseline.objects.bulk_create([
            OptionOIBaseline(index_key="nifty", expiry=EXPIRY, strike=strike, option_type=option_type, trade_date=DAY, prev_oi=800)
            for strike in (22550, 22600, 22650) for option_type in ("CE", "PE")])

    def test_trend_sums_selected_strikes_against_previous_close(self):
        data = trend_payload("nifty", EXPIRY, 3, 5)
        self.assertEqual(data["baseline"], "previous close")
        latest, middle, first = data["rows"]
        self.assertEqual((first["callOiChange"], first["putOiChange"], first["sentiment"]), (600, 600, "Neutral"))
        self.assertEqual((middle["callOiChange"], middle["putOiChange"], middle["diff"]), (2100, 1200, -900))
        self.assertEqual(middle["strength"], -43)
        self.assertEqual(middle["dayBreak"], {"type": "DHB", "level": 22600})
        self.assertEqual((latest["diff"], latest["sentiment"], latest["changePcr"]), (2400, "Bullish", 2.0))
        self.assertEqual(latest["dayBreak"], {"type": "DLB", "level": 22600})
        self.assertEqual(latest["diffChange"], 3300)
        self.assertEqual([row["time"] for row in data["series"]], sorted(row["time"] for row in data["rows"]))

    def test_wider_intervals_keep_first_and_latest_rows(self):
        self.assertEqual(len(trend_payload("nifty", EXPIRY, 30, 5)["rows"]), 2)

    def test_chain_reports_buildup_pcr_and_oi_extremes(self):
        data = chain_payload("nifty", EXPIRY)
        self.assertEqual(data["atm"], 22550)
        row = next(row for row in data["rows"] if row["strike"] == 22600)
        self.assertEqual(row["call"]["oiChange"], 800)
        self.assertEqual(row["call"]["buildup"], "Long Build-up")
        self.assertEqual(row["put"]["ltpChange"], 0)
        self.assertEqual(row["pcr"], 1.5)
        self.assertEqual(data["totals"]["pcr"], 1.5)
        self.assertIsNotNone(row["call"]["iv"])

    def test_chain_adds_oi_change_over_the_chosen_window(self):
        # Latest recording 09:21: calls 1600 / puts 2400. Six minutes earlier (09:15): 1000 / 1000.
        data = chain_payload("nifty", EXPIRY, window=6)
        row = next(row for row in data["rows"] if row["strike"] == 22600)
        self.assertEqual((row["call"]["oiChangeWindow"], row["put"]["oiChangeWindow"]), (600, 1400))
        self.assertEqual((data["window"], data["windowFrom"]), (6, int(at(9, 15).replace(tzinfo=oi_recorder.MARKET_TZ).timestamp())))
        three = next(row for row in chain_payload("nifty", EXPIRY, window=3)["rows"] if row["strike"] == 22600)
        self.assertEqual(three["call"]["oiChangeWindow"], 100)
        early = chain_payload("nifty", EXPIRY, window=15)
        self.assertIsNone(early["windowFrom"])
        self.assertTrue(all(row["call"]["oiChangeWindow"] is None for row in early["rows"]))

    def test_window_build_up_totals_and_warming(self):
        data = chain_payload("nifty", EXPIRY, window=6)
        row = next(row for row in data["rows"] if row["strike"] == 22600)
        # Since 09:15: call OI 1000 -> 1600 with premium 100 -> 95 (writing); put OI 1000 -> 2400 with premium 100 -> 120.
        self.assertEqual((row["call"]["buildupWindow"], row["put"]["buildupWindow"]), ("Short Build-up", "Long Build-up"))
        self.assertEqual(data["windowTotals"], {"callOiChange": 1800, "putOiChange": 4200})
        self.assertEqual(data["windowStatus"], {"ready": True, "minutesRecorded": 6, "snapshots": 3})
        self.assertIsNotNone(row["call"]["delta"])
        # Latest OI: calls 1600 and puts 2400 at each strike; buyers get least (200,000) at 22600.
        self.assertEqual((data["expiry"], data["range"], data["maxPain"]), ("2026-10-27", "atm", 22600))
        warming = chain_payload("nifty", EXPIRY, window=15)
        self.assertEqual(warming["windowStatus"], {"ready": False, "minutesRecorded": 6, "snapshots": 3})
        self.assertIsNone(warming["windowTotals"])

    def test_one_missing_baseline_switches_every_strike_to_the_first_snapshot(self):
        OptionOIBaseline.objects.filter(strike=22650, option_type="PE").delete()
        data = trend_payload("nifty", EXPIRY, 3, 5)
        self.assertEqual(data["baseline"], "today's first snapshot")
        self.assertEqual((data["rows"][0]["callOiChange"], data["rows"][0]["putOiChange"]), (1800, 4200))

    def test_missing_baseline_falls_back_to_the_first_snapshot(self):
        OptionOIBaseline.objects.all().delete()
        data = trend_payload("nifty", EXPIRY, 3, 5)
        self.assertEqual(data["baseline"], "today's first snapshot")
        self.assertEqual(data["rows"][-1]["callOiChange"], 0)

    def test_empty_expiry_explains_how_data_arrives(self):
        self.assertIn("every 3 minutes", chain_payload("nifty", dt.date(2026, 11, 3))["message"])


class FakeKite:
    def __init__(self):
        self.history_calls = 0

    def quote(self, *keys):
        if len(keys) == 1 and isinstance(keys[0], list):  # kiteconnect accepts a list or separate arguments
            keys = tuple(keys[0])
        quotes = {"NSE:NIFTY 50": {"last_price": 22610}, "NSE:NIFTY BANK": {"last_price": 51000}, "BSE:SENSEX": {"last_price": 74000}}
        quotes.update({key: {"oi": 1000 + index, "last_price": 50, "ohlc": {"close": 45}, "volume": 10}
                       for index, key in enumerate(keys) if key.startswith("NFO:")})
        return {key: quotes[key] for key in keys if key in quotes}

    def historical_data(self, token, start, end, interval, oi=False):
        self.history_calls += 1
        candles = [{"date": dt.datetime(2026, 10, 21, 15, 27, tzinfo=dt.timezone(dt.timedelta(hours=5, minutes=30))), "close": 40, "oi": 900}]
        minute = dt.datetime(2026, 10, 22, 9, 15, tzinfo=dt.timezone(dt.timedelta(hours=5, minutes=30)))
        while minute.hour < 10 or minute.minute <= 3:
            candles.append({"date": minute, "close": 22600 if not oi else 41, "oi": 950 if oi else 0})
            minute += dt.timedelta(minutes=3)
        return candles


class OIRecorderTests(TestCase):
    def rows(self):
        return pd.DataFrame([{"exchange": "NFO", "tradingsymbol": f"NIFTY26O27{strike}{option_type}", "strike": strike,
                              "instrument_type": option_type, "instrument_token": strike * 10 + (option_type == "PE")}
                             for strike in range(22000, 23250, 50) for option_type in ("CE", "PE")])

    def setUp(self):
        oi_recorder._history_attempts.clear()

    def record(self, when, client):
        with patch("backend.oi_recorder.option_rows", return_value={"nifty": {EXPIRY: self.rows()}}), \
                patch("backend.oi_recorder.resolve_spot_tokens", return_value={"nifty": 256265}), \
                patch("backend.oi_recorder.get_master_contract"), patch("backend.oi_recorder.time.sleep"):
            return record_option_oi(when, client=client)

    def test_live_quotes_plus_history_fill_the_session_and_previous_close(self):
        client = FakeKite()
        saved = self.record(dt.datetime(2026, 10, 22, 10, 4, 30), client)
        self.assertEqual(saved, 2 * 25)
        self.assertEqual(client.history_calls, 1 + 50)
        self.assertEqual(OptionOIBaseline.objects.count(), 50)
        self.assertEqual(set(OptionOIBaseline.objects.values_list("prev_oi", flat=True)), {900})
        buckets = sorted(set(OptionOISnapshot.objects.values_list("bucket_time", flat=True)))
        self.assertEqual((buckets[0], buckets[-1], len(buckets)), (dt.datetime(2026, 10, 22, 9, 18), dt.datetime(2026, 10, 22, 10, 3), 16))
        live = OptionOISnapshot.objects.filter(bucket_time=dt.datetime(2026, 10, 22, 10, 3)).first()
        self.assertGreaterEqual(live.oi, 1000)  # the live quote is kept, not overwritten by history
        filled = OptionOISnapshot.objects.filter(bucket_time=dt.datetime(2026, 10, 22, 9, 30)).first()
        self.assertEqual((filled.oi, filled.ltp, filled.prev_close, filled.underlying), (950, 41, 40, 22600))

    def test_complete_instruments_are_not_fetched_again(self):
        client = FakeKite()
        self.record(dt.datetime(2026, 10, 22, 10, 4, 30), client)
        oi_recorder._history_attempts.clear()
        calls = client.history_calls
        self.record(dt.datetime(2026, 10, 22, 10, 7, 30), client)
        self.assertEqual(client.history_calls, calls)

    def test_skips_outside_market_hours(self):
        self.assertEqual(record_option_oi(dt.datetime(2026, 10, 22, 16, 0), client=FakeKite()), 0)
        self.assertEqual(record_option_oi(dt.datetime(2026, 10, 24, 11, 0), client=FakeKite()), 0)


class OIApiTests(TestCase):
    def setUp(self):
        user = User(username="oi-user")
        user.set_password("test-password")
        user.save()
        login = self.client.post("/api/login/", json.dumps({"username": "oi-user", "password": "test-password"}),
                                 content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}

    def test_requires_login_and_validates_parameters(self):
        self.assertEqual(self.client.get("/api/oi/chain/?index=nifty&expiry=2026-10-27").status_code, 400)
        bad = self.client.get("/api/oi/trend/?index=nifty&expiry=2026-10-27&interval=4&strikes=7", **self.headers)
        self.assertEqual(bad.json()["message"], "Invalid interval or strike range.")
        bad_window = self.client.get("/api/oi/chain/?index=nifty&expiry=2026-10-27&window=5", **self.headers)
        self.assertEqual((bad_window.status_code, bad_window.json()["message"]), (400, "Choose an OI change window of 3, 6, 15, 30 or 60 minutes."))
        bad = self.client.get("/api/oi/chain/?index=midcap100&expiry=2026-10-27", **self.headers)
        self.assertEqual(bad.status_code, 400)
        for index in ("finnifty", "midcpnifty"):
            new = self.client.get(f"/api/oi/chain/?index={index}&expiry=2026-10-27", **self.headers)
            self.assertEqual((new.status_code, new.json()["rows"]), (200, []))
        bad_range = self.client.get("/api/oi/chain/?index=nifty&expiry=2026-10-27&range=some", **self.headers)
        self.assertEqual(bad_range.json()["message"], "Choose ATM ±12 or the whole chain.")
        empty = self.client.get("/api/oi/trend/?index=sensex&expiry=2026-10-27&interval=15&strikes=7", **self.headers)
        self.assertEqual((empty.json()["type"], empty.json()["rows"]), ("success", []))


class LiveChainTests(TestCase):
    def setUp(self):
        self.frame = pd.DataFrame([{"name": "NIFTY", "exchange": "NFO", "tradingsymbol": f"NIFTY26O27{strike}{option_type}",
                                    "strike": strike, "instrument_type": option_type, "expiry": pd.Timestamp(EXPIRY)}
                                   for strike in range(22000, 23250, 50) for option_type in ("CE", "PE")])
        self.client = FakeKite()

    def live(self):
        with patch("backend.oi_analysis.broker", return_value=(self.client, "session")), \
                patch("backend.oi_analysis.catalogue", return_value=self.frame):
            return live_chain_payload("nifty", EXPIRY)

    def test_prices_the_index_then_streams_the_atm_window(self):
        first = self.live()
        self.assertEqual((first["rows"], first["retryAfterMs"] > 0), ([], True))
        LiveMarketFeedRow = __import__("backend.models", fromlist=["LiveMarketFeed"]).LiveMarketFeed
        LiveMarketFeedRow.objects.filter(pk=2).update(lease_until=0)
        data = self.live()
        self.assertTrue(data["live"])
        self.assertEqual(len(data["rows"]), 25)
        self.assertEqual((data["underlying"], data["atm"], data["baseline"]), (22610, 22600, "unavailable"))
        row = next(row for row in data["rows"] if row["strike"] == 22600)
        # Nothing recorded yet today, so the day change is unknown rather than a misleading zero.
        self.assertEqual((row["call"]["ltp"], row["call"]["ltpChange"], row["call"]["oiChange"]), (50, 5, None))

    def test_whole_chain_and_atm_window(self):
        quote = self.client.quote

        def heavy_far_put(*keys):
            quotes = quote(*keys)
            if "NFO:NIFTY26O2723200PE" in quotes:
                quotes["NFO:NIFTY26O2723200PE"] = {**quotes["NFO:NIFTY26O2723200PE"], "oi": 10 ** 9}
            return quotes
        self.client.quote = heavy_far_put
        self.live()
        LiveMarketFeed.objects.filter(pk=2).update(lease_until=0)
        with patch("backend.oi_analysis.LIVE_STRIKES_EACH_SIDE", 5):
            atm = self.live()
        self.assertEqual((len(atm["rows"]), atm["totalStrikes"], atm["range"]), (11, 25, "atm"))
        self.assertNotIn(23200, [row["strike"] for row in atm["rows"]])
        self.assertEqual(atm["maxPain"], 23200)  # the far strike's OI counts although it is not on screen
        LiveMarketFeed.objects.filter(pk=2).update(lease_until=0)
        with patch("backend.oi_analysis.broker", return_value=(self.client, "session")), \
                patch("backend.oi_analysis.catalogue", return_value=self.frame):
            whole = live_chain_payload("nifty", EXPIRY, strike_range="all")
        self.assertEqual((len(whole["rows"]), whole["range"]), (25, "all"))
        self.assertIn("delta", whole["rows"][0]["call"])

    def test_uses_previous_close_baselines_when_recorded(self):
        OptionOIBaseline.objects.bulk_create([
            OptionOIBaseline(index_key="nifty", expiry=EXPIRY, strike=strike, option_type=option_type,
                             trade_date=dt.datetime.now(oi_recorder.MARKET_TZ).date(), prev_oi=500)
            for strike in range(22000, 23250, 50) for option_type in ("CE", "PE")])
        self.live()
        __import__("backend.models", fromlist=["LiveMarketFeed"]).LiveMarketFeed.objects.filter(pk=2).update(lease_until=0)
        data = self.live()
        self.assertEqual(data["baseline"], "previous close")
        self.assertTrue(all(row["call"]["oiChange"] >= 500 for row in data["rows"]))

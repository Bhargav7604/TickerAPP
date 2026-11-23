import datetime as dt
import json
from unittest.mock import patch

import pandas as pd
from django.test import SimpleTestCase, TestCase

from . import straddle
from .market_contracts import MARKET_TZ
from .models import OptionOISnapshot, User
from .oi_recorder import SPOT_KEYS

DAY = dt.date(2026, 11, 20)
EXPIRY = dt.date(2026, 11, 24)
STRIKES = [25000.0 + 50 * n for n in range(21)]   # 25000 ... 26000


def prices_around(centre, spot_premium=0.0):
    """Made-up option prices: calls fall and puts rise with the strike; the synthetic future sits near centre + premium."""
    forward = centre + spot_premium
    prices = {}
    for strike in STRIKES:
        prices[(strike, "CE")] = round(max(forward - strike, 0) + 40 - abs(forward - strike) * 0.05, 2)
        prices[(strike, "PE")] = round(max(strike - forward, 0) + 40 - abs(forward - strike) * 0.05, 2)
    return prices


def snapshots(at, spot, prices, strikes=STRIKES):
    return [OptionOISnapshot(index_key="nifty", expiry=EXPIRY, strike=strike, option_type=kind, bucket_time=at, underlying=spot,
                             oi=1000, ltp=prices[(strike, kind)]) for strike in strikes for kind in ("CE", "PE")]


class LadderTests(SimpleTestCase):
    def test_atm_follows_the_synthetic_future_not_spot(self):
        # Spot 25510 is nearest 25500, but calls priced 70 points over puts there put the synthetic future at 25570.
        prices = {(25500.0, "CE"): 120.0, (25500.0, "PE"): 50.0}
        atm, synthetic = straddle.atm_and_synthetic(STRIKES, prices, 25510)
        self.assertEqual((STRIKES[atm], synthetic), (25550.0, 25570.0))
        # Without both legs at the spot strike, ATM is the strike nearest spot.
        self.assertEqual(STRIKES[straddle.atm_and_synthetic(STRIKES, {}, 25510)[0]], 25500.0)
        self.assertEqual(straddle.atm_and_synthetic(STRIKES, prices, None), (None, None))

    def test_ladder_pairs_calls_above_with_puts_below_and_leaves_missing_pairs_empty(self):
        prices = prices_around(25500)
        rows = {row["key"]: row for row in straddle.ladder(STRIKES, prices, STRIKES.index(25500.0))}
        self.assertEqual(list(rows), ["ITM1", "ATM", "OTM1", "OTM2", "OTM3", "OTM4", "OTM5", "OTM6", "OTM7"])
        self.assertEqual((rows["ATM"]["ceStrike"], rows["ATM"]["peStrike"], rows["ATM"]["total"]), (25500.0, 25500.0, 80.0))
        self.assertEqual((rows["OTM2"]["ceStrike"], rows["OTM2"]["peStrike"]), (25600.0, 25400.0))
        self.assertEqual((rows["ITM1"]["ceStrike"], rows["ITM1"]["peStrike"]), (25450.0, 25550.0))
        self.assertEqual(rows["OTM2"]["total"], round(prices[(25600.0, "CE")] + prices[(25400.0, "PE")], 2))
        edge = {row["key"]: row for row in straddle.ladder(STRIKES, prices, 2)}   # ATM 25100: no put seven strikes below
        self.assertEqual((edge["OTM2"]["peStrike"], edge["OTM3"]["total"]), (25000.0, None))
        del prices[(25550.0, "CE")]
        self.assertIsNone(straddle.ladder(STRIKES, prices, STRIKES.index(25500.0))[2]["total"])  # OTM1 lost its call


class StraddlePayloadTests(TestCase):
    def setUp(self):
        straddle.clear_cache()
        self.addCleanup(straddle.clear_cache)
        self.morning = dt.datetime.combine(DAY, dt.time(9, 18))
        OptionOISnapshot.objects.bulk_create(snapshots(self.morning, 25490, prices_around(25500))
                                             + snapshots(self.morning + dt.timedelta(minutes=3), 25612, prices_around(25600)))
        # An earlier session for the same expiry, to list as a second day.
        OptionOISnapshot.objects.bulk_create(snapshots(dt.datetime(2026, 11, 19, 15, 30), 25400, prices_around(25400), STRIKES[:3]))

    def at(self, hour, minute):
        return dt.datetime.combine(DAY, dt.time(hour, minute), tzinfo=MARKET_TZ)

    def test_after_the_close_the_recorded_day_is_drawn_with_its_last_point_as_current(self):
        with patch("backend.straddle.live_point") as live:
            payload = straddle.straddle_payload("nifty", EXPIRY, now=self.at(16, 0))
        live.assert_not_called()
        self.assertEqual((payload["day"], payload["days"], payload["dte"], payload["live"]), ("2026-11-20", ["2026-11-20", "2026-11-19"], 4, False))
        self.assertEqual(payload["series"]["atm"], [25500.0, 25600.0])
        self.assertEqual(payload["series"]["lines"]["ATM"], [80.0, 80.0])
        self.assertEqual(payload["series"]["times"], [int(self.at(9, 18).timestamp()), int(self.at(9, 21).timestamp())])
        self.assertEqual((payload["current"]["atm"], payload["current"]["spot"]), (25600.0, 25612))
        self.assertEqual(payload["message"], "")

    def test_live_quotes_add_the_latest_point_without_growing_the_cached_day(self):
        live = straddle.point(int(self.at(9, 23).timestamp()) + 40, STRIKES, prices_around(25650), 25655)
        with patch("backend.straddle.live_point", return_value=live):
            payload = straddle.straddle_payload("nifty", EXPIRY, now=self.at(9, 23))
        self.assertTrue(payload["live"])
        self.assertEqual(payload["series"]["atm"], [25500.0, 25600.0, 25650.0])
        self.assertEqual(payload["current"]["at"], live["at"])
        with patch("backend.straddle.live_point", return_value=None):
            again = straddle.straddle_payload("nifty", EXPIRY, now=self.at(9, 23))
        self.assertEqual((again["live"], again["series"]["atm"]), (False, [25500.0, 25600.0]))

    def test_rows_backfilled_into_the_day_rebuild_the_cached_series(self):
        with patch("backend.straddle.live_point", return_value=None):
            straddle.straddle_payload("nifty", EXPIRY, now=self.at(16, 0))
            OptionOISnapshot.objects.bulk_create(snapshots(self.morning - dt.timedelta(minutes=3), 25450, prices_around(25450)))
            payload = straddle.straddle_payload("nifty", EXPIRY, now=self.at(16, 0))
        self.assertEqual(payload["series"]["atm"], [25450.0, 25500.0, 25600.0])

    def test_a_day_without_recordings_is_empty_with_the_usual_message(self):
        payload = straddle.straddle_payload("nifty", EXPIRY, day=dt.date(2026, 11, 18), now=self.at(16, 0))
        self.assertEqual((payload["series"]["times"], payload["current"]), ([], None))
        self.assertIn("No OI recorded yet", payload["message"])


class LivePointTests(TestCase):
    def setUp(self):
        straddle.clear_cache()
        rows = [{"name": "NIFTY", "expiry": pd.Timestamp(EXPIRY), "strike": strike, "exchange": "NFO", "instrument_type": kind,
                 "tradingsymbol": f"NIFTY26N24{int(strike)}{kind}", "lot_size": 65} for strike in STRIKES for kind in ("CE", "PE")]
        self.frame = pd.DataFrame(rows)
        prices = prices_around(25600)

        class Client:
            def quote(self, *names):
                quotes = {}
                for name in names:
                    if name == SPOT_KEYS["nifty"]:
                        quotes[name] = {"last_price": 25602.5, "ohlc": {}, "oi": None}
                        continue
                    symbol = name.split(":", 1)[1]
                    strike, kind = float(symbol[10:-2]), symbol[-2:]
                    quotes[name] = {"last_price": prices[(strike, kind)], "oi": 10, "ohlc": {"close": 1}, "volume": 5}
                return quotes
        self.client = Client()

    def test_live_ladder_comes_from_the_shared_quote_cache(self):
        with patch("backend.straddle.broker", return_value=(self.client, "session")), \
                patch("backend.straddle.catalogue", return_value=self.frame):
            current = straddle.live_point("nifty", EXPIRY)
        self.assertEqual((current["spot"], current["atm"]), (25602.5, 25600.0))
        self.assertEqual([row["total"] for row in current["rows"]][:2], [round(prices_around(25600)[(25550.0, "CE")] + prices_around(25600)[(25650.0, "PE")], 2), 80.0])
        self.assertIsNotNone(current["rows"][-1]["total"])   # OTM 7 is inside the live strike window

    def test_a_known_spot_quotes_only_the_strikes_around_atm(self):
        asked = []
        quote = self.client.quote
        self.client.quote = lambda *names: asked.extend(names) or quote(*names)
        with patch("backend.straddle.broker", return_value=(self.client, "session")), \
                patch("backend.straddle.catalogue", return_value=self.frame), patch("backend.straddle.live_spot", return_value=25602.5):
            current = straddle.live_point("nifty", EXPIRY)
        self.assertEqual(current["atm"], 25600.0)
        # The index plus calls and puts from ATM-9 (25150) to the top listed strike (26000, eight above ATM).
        self.assertEqual(len(asked), 1 + 2 * 18)

    def test_no_zerodha_session_means_no_live_point(self):
        with patch("backend.straddle.broker", return_value=(None, None)):
            self.assertIsNone(straddle.live_point("nifty", EXPIRY))


class StraddleViewTests(TestCase):
    def setUp(self):
        straddle.clear_cache()
        user = User(username="straddle-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}),
                                    content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_the_view_checks_the_user_and_the_inputs(self):
        self.assertEqual(self.client.get("/api/straddle/?index=nifty&expiry=2026-11-24").status_code, 400)
        bad_index = self.client.get("/api/straddle/?index=bankex&expiry=2026-11-24", **self.headers)
        self.assertEqual((bad_index.status_code, bad_index.json()["message"]), (400, "Select NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY or SENSEX."))
        bad_day = self.client.get("/api/straddle/?index=nifty&expiry=2026-11-24&day=yesterday", **self.headers)
        self.assertEqual((bad_day.status_code, bad_day.json()["message"]), (400, "Select a valid day."))

    def test_the_view_returns_the_payload(self):
        OptionOISnapshot.objects.bulk_create(snapshots(dt.datetime.combine(DAY, dt.time(9, 18)), 25490, prices_around(25500)))
        with patch("backend.straddle.live_point", return_value=None):
            data = self.client.get(f"/api/straddle/?index=nifty&expiry={EXPIRY}&day={DAY}", **self.headers).json()
        self.assertEqual((data["type"], data["label"], data["current"]["atm"]), ("success", "NIFTY", 25500.0))

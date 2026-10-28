import datetime as dt
from unittest.mock import patch

from django.test import TestCase

from .decision import big_players, direction, expected_range, light, must_know, trap
from .market_contracts import MARKET_TZ
from .models import MarketNote
from .oi_analysis import decay_and_odds

T = dt.datetime(2026, 10, 28, 11, 0)


def at(hour, minute):
    return dt.datetime(2026, 10, 28, hour, minute, tzinfo=MARKET_TZ)


class DirectionTests(TestCase):
    def series(self, start, end, vwap):
        return [(T + dt.timedelta(minutes=5 * i), start + (end - start) * i / 6, vwap) for i in range(7)]

    def test_up_needs_a_real_move_and_price_above_vwap(self):
        self.assertEqual(direction(self.series(22500, 22560, 22510))["code"], "up")
        self.assertEqual(direction(self.series(22500, 22560, 22600))["code"], "flat")  # rising but still below VWAP
        self.assertEqual(direction(self.series(22500, 22510, 22400))["code"], "flat")  # 0.04% is noise

    def test_down_and_detail_text(self):
        result = direction(self.series(22600, 22540, 22580))
        self.assertEqual(result["label"], "Going down")
        self.assertIn("down 0.27% in the last 30 minutes", result["detail"])

    def test_not_enough_data(self):
        self.assertEqual(direction([])["detail"], "Not enough data yet today.")


class PlayersTrapLightTests(TestCase):
    def test_options_lead_and_futures_can_veto(self):
        bullish = {"strength": 45, "putOiChange": 2e7, "callOiChange": 1e7}
        self.assertEqual(big_players(bullish, 300)["code"], "buying")
        self.assertEqual(big_players(bullish, None)["code"], "buying")
        self.assertEqual(big_players(bullish, -300)["code"], "mixed")
        self.assertEqual(big_players({**bullish, "strength": -60}, None)["code"], "selling")
        self.assertEqual(big_players(None, -50)["code"], "selling")
        self.assertEqual(big_players({**bullish, "strength": 5}, None)["code"], "mixed")

    def test_trap_only_when_price_and_players_disagree(self):
        self.assertEqual(trap("up", "selling")["message"], "Careful. This rise may not last. Don't chase it.")
        self.assertIn("fall may not last", trap("down", "buying")["message"])
        self.assertIsNone(trap("up", "buying"))
        self.assertIsNone(trap("flat", "selling"))

    def test_light_colours(self):
        self.assertEqual(light(at(11, 0), True, False, False, None, "up", "buying", [])["color"], "green")
        self.assertEqual(light(at(11, 0), True, False, False, None, "flat", "buying", [])["color"], "yellow")
        self.assertEqual(light(at(11, 0), True, False, False, None, "up", "mixed", [])["color"], "yellow")
        self.assertEqual(light(at(17, 0), False, False, False, None, "up", "buying", [])["label"], "Market closed")

    def test_red_reasons(self):
        self.assertIn("First 15 minutes", light(at(9, 20), True, False, False, None, "up", "buying", [])["reasons"][0])
        self.assertIn("Last hour of expiry", light(at(14, 40), True, False, True, None, "up", "buying", [])["reasons"][0])
        self.assertEqual(light(at(14, 40), True, False, False, None, "up", "buying", [])["color"], "green")
        self.assertIn("data is late", light(at(11, 0), True, True, False, None, "up", "buying", [])["reasons"][0])
        self.assertIn("possible trap", light(at(11, 0), True, False, False, {"message": "x"}, "up", "selling", [])["reasons"][0])
        self.assertEqual(light(at(11, 0), True, False, False, None, "up", "buying", ["RBI policy at 10 am"])["reasons"],
                         ["Big news today: RBI policy at 10 am"])


class RangeAndOptionsTests(TestCase):
    def chain(self):
        side = lambda oi, iv: {"oi": oi, "iv": iv}
        return {"underlying": 22610, "atm": 22600, "rows": [
            {"strike": 22500, "call": side(1e6, 15), "put": side(9e6, 15)},
            {"strike": 22600, "call": side(3e6, 14), "put": side(4e6, 16)},
            {"strike": 22800, "call": side(8e6, 15), "put": side(9.5e6, 15)},
        ]}

    def test_expected_range_uses_atm_iv_and_time_left(self):
        result = expected_range("nifty", self.chain(), dt.date(2026, 11, 3), at(10, 0))
        self.assertEqual(result["iv"], 15.0)
        self.assertEqual((result["low"], result["high"]), (22150, 23100))  # 22610 ± 443 (15% IV, 6.2 days)
        self.assertEqual((result["support"], result["resistance"]), (22500, 22800))
        self.assertIn("until expiry on 03 Nov", result["text"])

    def test_no_range_after_expiry_or_without_iv(self):
        self.assertIsNone(expected_range("nifty", self.chain(), dt.date(2026, 10, 27), at(10, 0)))
        self.assertIsNone(expected_range("nifty", {"rows": []}, dt.date(2026, 11, 3), at(10, 0)))

    def test_time_decay_grows_into_expiry_and_far_options_are_lottery_tickets(self):
        week, _ = decay_and_odds(22600, 22600, 5 / 365, "CE", 14)
        last_hours, _ = decay_and_odds(22600, 22600, 3 / (365 * 24), "CE", 14)
        self.assertGreater(last_hours, week * 3)
        _, far = decay_and_odds(22600, 23000, 3 / (365 * 24), "CE", 14)
        _, near = decay_and_odds(22600, 22600, 3 / (365 * 24), "CE", 14)
        self.assertLess(far, 5)
        self.assertGreater(near, 40)


class MustKnowTests(TestCase):
    def test_lists_dangers_first_with_expiry_ban_and_notes(self):
        MarketNote.objects.create(date=dt.date(2026, 10, 28), message="RBI policy at 10 am", level="warning")
        calendar = {"nifty": [{"label": "Today"}], "sensex": [{"label": "Tomorrow"}], "banknifty": []}
        cards = [{"late": True, "asOf": int(at(13, 55).timestamp())}]
        items = must_know(at(9, 20), cards, calendar, list(MarketNote.objects.all()), ["SAIL"])
        self.assertEqual([item["level"] for item in items][:2], ["danger", "danger"])
        texts = " ".join(item["text"] for item in items)
        for expected in ("data is late", "NIFTY options expire today", "SENSEX options expire tomorrow", "SAIL", "First 15 minutes", "RBI policy"):
            self.assertIn(expected, texts)

    def test_ban_list_failure_is_reported(self):
        items = must_know(at(11, 0), [], {}, [], None)
        self.assertIn("Could not load today's F&O ban list", items[0]["text"])


class DecisionApiTests(TestCase):
    def test_requires_login(self):
        self.assertEqual(self.client.get("/api/decision/").status_code, 400)

    @patch("backend.decision.ban_list", return_value=[])
    @patch("backend.decision.expiry_calendar", return_value={"nifty": [], "banknifty": [], "sensex": []})
    @patch("backend.decision.resolve_contracts", return_value={})
    def test_payload_without_data_is_safe(self, *_):
        from .decision import decision_payload
        data = decision_payload(at(11, 0))
        self.assertEqual([card["label"] for card in data["cards"]], ["NIFTY", "BANKNIFTY", "SENSEX"])
        self.assertTrue(all(card["light"]["color"] == "red" and card["late"] for card in data["cards"]))
        self.assertIn("SEBI-registered", data["disclaimer"])

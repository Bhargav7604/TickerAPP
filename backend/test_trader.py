import datetime as dt
import json
from unittest.mock import patch

from django.test import TestCase

from . import alerts as alert_module
from . import coach
from .alerts import check_outcomes, create_alert, generate_alerts, report_card, verify_record
from .market_contracts import MARKET_TZ
from .models import Alert, CheckIn, MarketSnapshot, Trade, TraderProfile, User
from .risk import (break_even_odds, expiry_close_level, option_cost, position_size, protect_profit, seller_alarm,
                   stock_expiry_warning, what_if)


def at(day, hour, minute=0):
    return dt.datetime(2026, 10, day, hour, minute, tzinfo=MARKET_TZ)


class RiskTests(TestCase):
    def test_position_size_respects_risk_and_licence(self):
        size = position_size(100000, 1, 22600, 22500, 65)
        self.assertEqual((size["lots"], size["riskPerLot"], size["budget"]), (0, 6500, 1000))
        self.assertIn("more than your ₹1,000 limit", size["text"])
        size = position_size(1000000, 1, 22600, 22500, 65, lots_wanted=3)
        self.assertEqual(size["lots"], 1)
        self.assertIn("too much risk", size["warning"])
        self.assertEqual(position_size(10000000, 1, 22600, 22500, 65, licence_level=1)["lots"], 1)

    def test_what_if_for_futures_and_options(self):
        futures = what_if({"side": "buy", "lots": 1, "lot_size": 65, "instrument": "FUT", "entry": 22600})
        self.assertEqual([item["pnl"] for item in futures], [-14690, -7345, 7345, 14690])
        option = what_if({"side": "buy", "lots": 1, "lot_size": 65, "instrument": "CE", "entry": 120, "strike": 22600}, 22600, 5 / 365, 14)
        self.assertEqual(option[-1]["label"], "If option prices drop after the news")
        self.assertLess(option[-1]["pnl"], 0)
        self.assertLess(option[0]["pnl"], option[3]["pnl"])

    def test_break_even_odds_in_plain_words(self):
        result = break_even_odds(22600, 22700, 20, "CE", 3 / (365 * 24), 14, "NIFTY", "3:30 pm today")
        self.assertEqual(result["pointsNeeded"], 120)
        self.assertTrue(result["text"].startswith("NIFTY must rise 120 points"))
        self.assertIn("That looks unlikely.", result["text"])

    def test_protect_profit_keeps_two_thirds(self):
        result = protect_profit("buy", 100, 130, 1, 100)
        self.assertEqual((result["openPnl"], result["exitLevel"], result["keeps"]), (3000, 120, 2000))
        self.assertIn("You are up ₹3,000. An exit at 120.00 would keep at least ₹2,000.", result["text"])
        self.assertIsNone(protect_profit("sell", 100, 130, 1, 100))

    def test_seller_alarm_and_margin_estimate(self):
        result = seller_alarm(22600, 22700, "CE", 80, 1, 65, 5 / 365, 14, "NIFTY")
        self.assertGreater(result["lossOnShock"], 0)
        self.assertTrue(result["marginEstimated"])
        self.assertIn("your loss has no upper limit", result["text"])
        self.assertFalse(seller_alarm(22600, 22700, "CE", 80, 1, 65, 5 / 365, 14, margin=150000)["marginEstimated"])

    def test_stock_expiry_delivery_warning(self):
        trade = {"index_key": "", "expiry": dt.date(2026, 10, 29), "lots": 1, "lot_size": 500, "instrument": "FUT",
                 "side": "buy", "strike": None, "symbol": "RELIANCE26OCTFUT"}
        warning = stock_expiry_warning(trade, 1200, dt.date(2026, 10, 28))
        self.assertEqual(warning["amount"], 600000)
        self.assertIn("expires tomorrow", warning["text"])
        self.assertIsNone(stock_expiry_warning({**trade, "instrument": "CE", "strike": 1300}, 1200, dt.date(2026, 10, 28)))
        self.assertIsNone(stock_expiry_warning({**trade, "index_key": "nifty"}, 1200, dt.date(2026, 10, 28)))
        self.assertIsNone(stock_expiry_warning(trade, 1200, dt.date(2026, 10, 20)))

    def test_option_cost_and_expiry_close(self):
        self.assertEqual(option_cost(19.5)["level"], "costly")
        self.assertEqual(option_cost(11)["level"], "cheap")
        self.assertIsNone(option_cost(None))
        rows = [{"strike": 22500, "call": {"oi": 1e5}, "put": {"oi": 9e6}}, {"strike": 22600, "call": {"oi": 4e6}, "put": {"oi": 4e6}},
                {"strike": 22700, "call": {"oi": 9e6}, "put": {"oi": 1e5}}]
        result = expiry_close_level(rows, 22610)
        self.assertEqual(result["maxPain"], 22600)
        self.assertEqual(result["jumpLevels"], [22500, 22700])


class AlertTests(TestCase):
    def card(self, **overrides):
        card = {"key": "nifty", "label": "NIFTY", "price": 22600.0, "late": False, "trap": None, "expiry": None,
                "direction": {"code": "up", "move": 0.4}, "light": {"color": "green"}, "numbers": {"oi": {"strength": 50}}}
        card.update(overrides)
        return card

    def payload(self, *cards):
        return {"marketOpen": True, "cards": list(cards)}

    def setUp(self):
        alert_module._seen.clear()

    def test_locked_record_detects_any_edit(self):
        first = create_alert(at(28, 10), "nifty", "trend", "strong", "wait", "up", "NIFTY is rising", 22600)
        create_alert(at(28, 11), "nifty", "trap", "medium", "confirmed", "down", "NIFTY trap", 22650)
        self.assertEqual(verify_record(), (True, None))
        with self.assertRaises(ValueError):
            first.message = "changed"
            first.save()
        with self.assertRaises(ValueError):
            Alert.objects.get(pk=first.pk).delete()
        Alert.objects.filter(pk=first.pk).update(price=1)  # a raw database edit bypassing the app
        self.assertEqual(verify_record(), (False, first.pk))

    @patch("backend.alerts.send_telegram")
    def test_strong_alerts_warn_early_others_wait_for_confirmation(self, send):
        made = generate_alerts(at(28, 11), self.payload(self.card()))
        self.assertEqual([(alert.strength, alert.status) for alert in made], [("strong", "wait")])
        self.assertEqual(generate_alerts(at(28, 11, 5), self.payload(self.card())), [])  # same signal within 45 minutes
        weak = self.card(key="sensex", label="SENSEX", direction={"code": "up", "move": 0.05}, numbers={"oi": {"strength": 5}})
        self.assertEqual(generate_alerts(at(28, 11, 10), self.payload(weak)), [])
        made = generate_alerts(at(28, 11, 15), self.payload(weak))
        self.assertEqual([(alert.strength, alert.status) for alert in made], [("weak", "confirmed")])

    @patch("backend.alerts.send_telegram")
    def test_daily_cap_and_closed_market(self, send):
        for hour in range(8):
            create_alert(at(28, 9 + hour % 6, hour * 5), "banknifty", "trend", "weak", "wait", "up", "x", 1)
        self.assertEqual(generate_alerts(at(28, 15), self.payload(self.card())), [])
        self.assertEqual(generate_alerts(at(28, 17), {"marketOpen": False, "cards": []}), [])

    def test_outcomes_and_report_card(self):
        up = create_alert(at(28, 10), "nifty", "trend", "strong", "confirmed", "up", "rise", 22600)
        down = create_alert(at(28, 10, 5), "nifty", "trap", "medium", "confirmed", "down", "trap", 22600)
        MarketSnapshot.objects.create(index_key="nifty", contract_month="current", symbol="NIFTY26NOVFUT", instrument_type="FUT",
                                      bucket_time=dt.datetime(2026, 10, 28, 10, 30), index_level=22650)
        self.assertEqual(check_outcomes(at(28, 10, 40)), 2)
        up.refresh_from_db()
        down.refresh_from_db()
        self.assertEqual((up.outcome, down.outcome), ("right", "wrong"))
        self.assertEqual(verify_record(), (True, None))  # scoring does not break the lock
        card = report_card(2026, 10)
        self.assertEqual((card["right"], card["wrong"], card["hitRate"]), (1, 1, 50))


class CoachTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="coach-user")
        self.profile = TraderProfile.objects.create(user=self.user, capital=100000, monthly_loss_limit=5000)

    def trade(self, when, pnl_points=0.0, **extra):
        values = {"user": self.user, "opened_at": when.replace(tzinfo=None), "symbol": "NIFTY26NOVFUT", "index_key": "nifty", "side": "buy",
                  "lot_size": 1, "entry": 100, "stop": 90, "exit": 100 + pnl_points, "light_at_entry": "green", "checklist_ready": True}
        values.update(extra)
        return Trade.objects.create(**values)

    def test_licence_promotion_and_demotion(self):
        for day in range(20):
            self.trade(at(1 + day % 20, 10) - dt.timedelta(days=30), 5)
        self.assertEqual(coach.licence(self.user, self.profile, at(28, 10))["level"], 1)
        self.trade(at(27, 10), -20, practice=False)  # exit 80 is beyond the stop at 90
        self.trade(at(26, 10), -5, practice=False, light_at_entry="red")
        result = coach.licence(self.user, self.profile, at(28, 10))
        self.assertEqual(result["level"], 0)
        self.assertIn("moved back a level", result["text"])

    def test_cooling_off_after_a_big_loss_and_monthly_limit(self):
        self.trade(at(27, 11), -2500, practice=False, lot_size=1)
        self.assertTrue(coach.cooling_off(self.user, self.profile, at(28, 9, 30))["active"])
        self.assertFalse(coach.cooling_off(self.user, self.profile, at(28, 10))["active"])
        self.trade(at(28, 11), -3000, practice=False)
        result = coach.cooling_off(self.user, self.profile, at(28, 12))
        self.assertTrue(result["allDay"])

    def test_checklist_needs_all_four(self):
        card = {"light": {"color": "green", "label": "Good time to trade."}, "expiry": None}
        result = coach.checklist(self.user, self.profile, card, [], at(28, 11), practice=True)
        self.assertFalse(result["ready"])
        self.assertEqual(result["verdict"], "Not ready. Take a 30-minute break.")
        CheckIn.objects.create(user=self.user, date=dt.date(2026, 10, 28), slept_well=True, upset=False, chasing_loss=False)
        self.assertTrue(coach.checklist(self.user, self.profile, card, [], at(28, 11), practice=True)["ready"])
        self.assertFalse(coach.checklist(self.user, self.profile, card, ["RBI policy"], at(28, 11), practice=True)["ready"])
        self.trade(at(28, 9, 40), -5)
        self.trade(at(28, 9, 50), -5)
        self.assertIn("You lost 2 times today", coach.checklist(self.user, self.profile, card, [], at(28, 11), True)["checks"][3]["text"])

    def test_coach_warnings(self):
        new = {"symbol": "NIFTY26NOVFUT", "side": "buy", "entry": 95, "lots": 3, "emotion": "revenge"}
        warnings = coach.coach_warnings(self.user, new, at(28, 10))
        self.assertIn("Start small. Your first trade of the day is best with one lot.", warnings)
        self.assertTrue(any("win back a loss" in text for text in warnings))
        self.trade(at(28, 9, 30), exit=None)
        self.assertIn("You're adding money to a losing trade.", coach.coach_warnings(self.user, new, at(28, 10)))

    def test_danger_times_lessons_and_emotion_cost(self):
        for week in range(3):
            self.trade(at(6 + week * 7, 14, 10), -10, emotion="greed")
        self.trade(at(27, 11), 15)
        danger = coach.danger_times(self.user, at(27, 14, 10))
        self.assertEqual(danger["times"][0]["label"], "Tuesdays between 2-3 pm")
        self.assertIn("You often lose on Tuesdays between 2-3 pm. It is 2:10 pm now.", danger["now"])
        self.trade(at(28, 10), -20, light_at_entry="red")
        lessons = coach.plan_lessons(self.user)
        self.assertEqual(lessons["lessons"][0]["text"], "The light was red. Waiting would have saved ₹20.")
        self.assertIn("greed cost you ₹30", coach.emotion_cost(self.user, at(28, 12))["text"])


class TraderApiTests(TestCase):
    def setUp(self):
        self.user = User(username="desk-user")
        self.user.set_password("test-password")
        self.user.save()
        login = self.client.post("/api/login/", json.dumps({"username": "desk-user", "password": "test-password"}), content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}

    def post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type="application/json", **self.headers)

    def test_learners_cannot_place_real_trades_and_practice_balance_moves(self):
        self.post("/api/trader/profile/", {"capital": 200000, "riskPct": 1, "monthlyLossLimit": 10000, "practiceMode": False})
        trade = {"symbol": "TESTFUT", "lotSize": 10, "instrument": "FUT", "side": "buy", "lots": 1, "entry": 100}
        blocked = self.post("/api/trader/trades/", trade)
        self.assertEqual(blocked.status_code, 403)
        self.assertIn("Learner's licence", blocked.json()["message"])
        self.post("/api/trader/profile/", {"practiceMode": True})
        made = self.post("/api/trader/trades/", trade).json()["trade"]
        self.assertEqual((made["practice"], made["stop"]), (True, 99.5))
        closed = self.post(f"/api/trader/trades/{made['id']}/close/", {"exit": 110}).json()
        self.assertEqual(closed["trade"]["pnl"], 100)
        self.assertEqual(TraderProfile.objects.get(user=self.user).practice_balance, 100100)

    def test_risk_over_five_percent_is_refused(self):
        response = self.post("/api/trader/profile/", {"riskPct": 8})
        self.assertEqual(response.status_code, 400)

    def test_plan_reports_size_and_what_if(self):
        self.post("/api/trader/profile/", {"capital": 500000, "riskPct": 1, "practiceMode": False})
        data = self.post("/api/trader/plan/", {"symbol": "TESTFUT", "lotSize": 10, "instrument": "FUT", "side": "buy", "lots": 2, "entry": 1000, "stop": 990}).json()
        self.assertEqual(data["sizing"]["lots"], 50)
        self.assertEqual(len(data["whatIf"]), 4)
        self.assertEqual([check["name"] for check in data["checklist"]["checks"]], ["Market", "News", "Money", "Mind"])

    def test_mentor_link_is_read_only_and_revocable(self):
        token = self.post("/api/trader/mentor-link/", {}).json()["mentorLink"]
        view = self.client.get(f"/api/mentor/{token}/").json()
        self.assertEqual(view["trader"], "de***")
        self.post("/api/trader/mentor-link/", {"revoke": True})
        self.assertEqual(self.client.get(f"/api/mentor/{token}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/mentor/{token}/").status_code, 405)

    def test_alerts_endpoint_reports_record_integrity(self):
        create_alert(at(28, 10), "nifty", "trend", "strong", "wait", "up", "NIFTY is rising", 22600)
        data = self.client.get("/api/trader/alerts/?month=2026-10", **self.headers).json()
        self.assertEqual((data["record"]["intact"], data["record"]["count"], len(data["alerts"])), (True, 1, 1))
        self.assertEqual(self.client.get("/api/trader/alerts/").status_code, 400)

    def test_practice_plans_size_from_pretend_money(self):
        self.post("/api/trader/profile/", {"capital": 500000, "riskPct": 1})
        data = self.post("/api/trader/plan/", {"symbol": "TESTFUT", "lotSize": 10, "instrument": "FUT", "side": "buy", "entry": 1000, "stop": 990}).json()
        self.assertEqual((data["sizing"]["budget"], data["sizing"]["lots"]), (1000, 10))

import json
from unittest.mock import patch

from django.test import TestCase

from .models import User


class AlertThresholdTests(TestCase):
    def setUp(self):
        self.user = User(username="threshold-user", alerts_enabled=True)
        self.user.set_password("test-password")
        self.user.save()
        login = self.client.post("/api/login/", json.dumps({"username": self.user.username, "password": "test-password"}),
                                 content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}

    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type="application/json", **self.headers)

    def test_new_users_get_a_smaller_sensex_default(self):
        self.assertEqual((self.user.alert_lot_threshold, self.user.banknifty_alert_lot_threshold, self.user.sensex_alert_lot_threshold),
                         (400.0, 400.0, 40.0))

    @patch("backend.views.resolve_contracts", return_value={})
    def test_each_index_threshold_is_saved_and_returned(self, contracts):
        response = self.post("/api/settings/save/", {"alertsEnabled": True,
                                                     "alertLotThresholds": {"nifty": 350, "banknifty": 300, "sensex": 25}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["settings"]["alertLotThresholds"], {"nifty": 350, "banknifty": 300, "sensex": 25})
        self.assertEqual(response.json()["settings"]["alertLotThreshold"], 350)
        self.user.refresh_from_db()
        self.assertEqual((self.user.alert_lot_threshold, self.user.banknifty_alert_lot_threshold, self.user.sensex_alert_lot_threshold),
                         (350, 300, 25))

    @patch("backend.views.resolve_contracts", return_value={})
    def test_single_threshold_from_older_clients_only_changes_nifty(self, contracts):
        response = self.post("/api/settings/save/", {"alertsEnabled": True, "alertLotThreshold": 250})
        self.assertEqual(response.json()["settings"]["alertLotThresholds"], {"nifty": 250, "banknifty": 400, "sensex": 40})

    @patch("backend.views.resolve_contracts", return_value={})
    def test_zero_threshold_is_rejected_while_alerts_are_on(self, contracts):
        response = self.post("/api/settings/save/", {"alertsEnabled": True,
                                                     "alertLotThresholds": {"nifty": 400, "banknifty": 400, "sensex": 0}})
        self.assertEqual(response.status_code, 400)

    def test_email_check_uses_the_index_threshold_and_includes_an_exact_match(self):
        below = self.post("/api/alerts/send/", {"indexKey": "sensex", "indexName": "SENSEX", "swingLots": -39})
        self.assertEqual(below.json()["message"], "Lot swing is below alert threshold.")
        reached = self.post("/api/alerts/send/", {"indexKey": "sensex", "indexName": "SENSEX", "swingLots": 40})
        self.assertEqual(reached.json()["message"], "On-screen alert only. Alert email is not configured.")
        by_name = self.post("/api/alerts/send/", {"indexName": "SENSEX", "swingLots": 44})
        self.assertEqual(by_name.json()["message"], "On-screen alert only. Alert email is not configured.")
        nifty = self.post("/api/alerts/send/", {"indexKey": "nifty", "indexName": "NIFTY", "swingLots": 44})
        self.assertEqual(nifty.json()["message"], "Lot swing is below alert threshold.")

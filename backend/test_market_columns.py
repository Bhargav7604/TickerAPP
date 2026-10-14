import json
from unittest.mock import patch

from django.test import TestCase

from .models import User
from .views import MARKET_COLUMN_IDS


class MarketColumnPreferenceTests(TestCase):
    def setUp(self):
        self.user = User(username="column-user", contract_month="next", alerts_enabled=True,
                         alert_email="alerts@example.com", alert_lot_threshold=123)
        self.user.set_password("test-password")
        self.user.save()
        self.other = User.objects.create(username="other-column-user")
        login = self.client.post("/api/login/", json.dumps({"username": self.user.username, "password": "test-password"}),
                                 content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}

    def save(self, body):
        return self.client.post("/api/settings/columns/", json.dumps(body), content_type="application/json", **self.headers)

    @patch("backend.views.resolve_contracts", return_value={})
    def test_selection_persists_in_account_settings_without_changing_other_preferences(self, contracts):
        response = self.save({"marketColumns": ["netLots", "futures", "futures"], "userId": self.other.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["marketColumns"], ["netLots", "futures"])
        self.user.refresh_from_db()
        self.assertEqual(self.user.market_columns, ["netLots", "futures"])
        self.other.refresh_from_db()
        self.assertIsNone(self.other.market_columns)
        self.assertEqual((self.user.contract_month, self.user.alerts_enabled, self.user.alert_email, self.user.alert_lot_threshold),
                         ("next", True, "alerts@example.com", 123))
        response = self.client.get("/api/settings/", **self.headers)
        self.assertEqual(response.json()["settings"]["marketColumns"], ["netLots", "futures"])

    @patch("backend.views.resolve_contracts", return_value={})
    def test_reordered_columns_survive_a_new_login_and_can_be_reordered_again(self, contracts):
        columns = list(reversed(MARKET_COLUMN_IDS))
        self.assertEqual(self.save({"marketColumns": columns}).json()["marketColumns"], columns)
        self.user.refresh_from_db()
        self.assertEqual(self.user.market_columns, columns)
        login = self.client.post("/api/login/", json.dumps({"username": self.user.username, "password": "test-password"}),
                                 content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + login.json()["jwtToken"]}
        response = self.client.get("/api/settings/", **self.headers)
        self.assertEqual(response.json()["settings"]["marketColumns"], columns)
        columns = ["oi", "netLots", "futures", "spot"]
        self.assertEqual(self.save({"marketColumns": columns}).json()["marketColumns"], columns)
        self.assertEqual(self.client.get("/api/settings/", **self.headers).json()["settings"]["marketColumns"], columns)

    def test_invalid_values_never_overwrite_previous_selection(self):
        self.save({"marketColumns": ["spot"]})
        for value in (None, [], "spot", ["unknown"], [1], [{}], ["spot"] * 13):
            with self.subTest(value=value):
                self.assertEqual(self.save({"marketColumns": value}).status_code, 400)
        self.assertEqual(self.save([]).status_code, 400)
        malformed = self.client.post("/api/settings/columns/", "{bad", content_type="application/json", **self.headers)
        self.assertEqual(malformed.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.market_columns, ["spot"])

    def test_requires_authentication_and_post(self):
        self.assertEqual(self.client.post("/api/settings/columns/", {"marketColumns": ["spot"]}).status_code, 400)
        self.assertEqual(self.client.get("/api/settings/columns/", **self.headers).status_code, 405)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.market_columns)

    @patch("backend.views.resolve_contracts", return_value={})
    def test_general_settings_save_cannot_clobber_column_preferences(self, contracts):
        self.save({"marketColumns": ["spot"]})
        response = self.client.post("/api/settings/save/", json.dumps({
            "contractMonth": "far", "marketColumns": ["futures"], "alertsEnabled": True,
            "alertEmail": "alerts@example.com", "alertLotThreshold": 123,
        }), content_type="application/json", **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["settings"]["marketColumns"], ["spot"])
        self.assertEqual(response.json()["settings"]["contractMonth"], "far")

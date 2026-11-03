import json
from unittest.mock import patch

from django.test import TestCase

from .models import RequestThrottle, SMTPSettings, User


class LoginAndSessionTests(TestCase):
    def setUp(self):
        self.user = User(username="guard-user", alerts_enabled=True, alert_email="trader@example.com")
        self.user.set_password("right-password")
        self.user.save()

    def login(self, password, username="guard-user"):
        return self.client.post("/api/login/", json.dumps({"username": username, "password": password}), content_type="application/json")

    def test_five_wrong_passwords_lock_the_login_for_fifteen_minutes(self):
        for _ in range(5):
            self.assertEqual(self.login("wrong").status_code, 400)
        locked = self.login("right-password")
        self.assertEqual(locked.status_code, 429)
        self.assertIn("Try again in 15 minutes", locked.json()["message"])
        RequestThrottle.objects.all().delete()
        self.assertEqual(self.login("right-password").status_code, 200)

    def test_a_good_login_clears_earlier_failures_and_unknown_names_count_too(self):
        for _ in range(4):
            self.login("wrong")
        self.assertEqual(self.login("right-password").status_code, 200)
        self.assertFalse(RequestThrottle.objects.filter(key="login:guard-user").exists())
        for _ in range(5):
            self.assertEqual(self.login("anything", username="nobody").status_code, 400)
        self.assertEqual(self.login("anything", username="nobody").status_code, 429)

    def test_logout_ends_the_session_on_the_server(self):
        token = self.login("right-password").json()["jwtToken"]
        headers = {"HTTP_AUTHORIZATION": "jwt-token " + token}
        self.assertEqual(self.client.get("/api/current-user/", **headers).status_code, 200)
        self.assertEqual(self.client.post("/api/logout/", **headers).status_code, 200)
        self.assertNotEqual(self.client.get("/api/current-user/", **headers).status_code, 200)

    @patch("backend.views.EmailMessage")
    @patch("backend.views.get_connection")
    def test_alert_emails_are_limited_to_one_per_index_every_five_minutes(self, connection, message):
        SMTPSettings.objects.create(enabled=True, host="smtp.example.com", port=587, username="bot@example.com", password="x")
        token = self.login("right-password").json()["jwtToken"]
        headers = {"HTTP_AUTHORIZATION": "jwt-token " + token}

        def send(index_key):
            return self.client.post("/api/alerts/send/", json.dumps({"indexKey": index_key, "indexName": index_key.upper(), "swingLots": 900}),
                                    content_type="application/json", **headers).json()["message"]

        self.assertEqual(send("nifty"), "Alert email sent.")
        self.assertEqual(send("nifty"), "An alert email for this index was sent a few minutes ago.")
        self.assertEqual(send("banknifty"), "Alert email sent.")
        self.assertEqual(message.return_value.send.call_count, 2)

    def test_health_check_does_not_reveal_internal_errors(self):
        with patch("backend.views.db_connection.ensure_connection", side_effect=Exception("host=db password=secret")):
            response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret", response.content.decode())

    def test_removed_broker_columns_and_dead_endpoints_are_gone(self):
        fields = {field.name for field in User._meta.get_fields()}
        self.assertFalse(fields & {"broker_password", "broker_twofa", "broker_api_secret", "broker_access_token"})
        self.assertEqual(self.client.post("/api/set-access-token/").status_code, 404)
        self.assertEqual(self.client.post("/api/snapshots/save/").status_code, 404)

import datetime as dt
import importlib
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from django.apps import apps
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import RequestFactory, TestCase
from django.utils import timezone

from .admin import TickerUserAdmin
from .live_feed import SharedMarketFeed
from .models import KiteSettings, LiveMarketFeed, MarketSnapshot, User
from .snapshot_recorder import record_market_snapshot
from .tests import instrument_frame
from .views import market_data


class UserSecurityTests(TestCase):
    def setUp(self):
        self.user = User(username="review-user")
        self.user.set_password("fixed-test-password")
        self.user.save()
        self.kite = KiteSettings.objects.create(api_key="dummy-key", api_secret="dummy-secret", access_token="dummy-token")

    def login(self, password="fixed-test-password"):
        return self.client.post("/api/login/", data=json.dumps({
            "username": self.user.username, "password": password,
        }), content_type="application/json")

    def headers(self):
        return {"HTTP_AUTHORIZATION": "jwt-token " + self.login().json()["jwtToken"]}

    def test_login_checks_hash_and_rejects_incorrect_password(self):
        self.assertNotEqual(self.user.password, "fixed-test-password")
        self.assertTrue(self.user.check_password("fixed-test-password"))
        self.assertEqual(self.login().json()["type"], "success")
        self.assertEqual(self.login("incorrect").status_code, 400)

    def test_migration_preserves_existing_fixed_passwords_and_expires_sessions(self):
        self.user.password = "legacy-fixed-password"
        self.user.active_session_token = "old-session"
        self.user.save()
        migration = importlib.import_module("backend.migrations.0018_secure_passwords_live_feed")
        migration.hash_existing_passwords(apps, SimpleNamespace(connection=connection))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("legacy-fixed-password"))
        self.assertEqual(self.user.active_session_token, "")

    def form(self, data, instance=None):
        staff = get_user_model().objects.create_superuser(
            username="admin-" + str(get_user_model().objects.count()), password="admin-test-password"
        )
        request = RequestFactory().get("/admin/backend/user/")
        request.user = staff
        model_admin = TickerUserAdmin(User, admin.site)
        form_class = model_admin.get_form(request, instance)
        return form_class(data=data, instance=instance)

    def test_admin_add_hashes_fixed_password_and_does_not_display_it(self):
        form = self.form({"username": "new-user", "password": "new-fixed-password", "valid_until": ""})
        self.assertTrue(form.is_valid(), form.errors)
        created = form.save()
        self.assertTrue(created.check_password("new-fixed-password"))
        self.assertNotEqual(created.password, "new-fixed-password")
        self.assertFalse(form.fields["password"].widget.render_value)

    def test_edit_without_password_preserves_hash_and_password_reset_revokes_session(self):
        headers = self.headers()
        self.user.refresh_from_db()
        original = self.user.password
        form = self.form({"username": self.user.username, "password": "", "valid_until": "", "contract_month": "current"}, self.user)
        self.assertTrue(form.is_valid(), form.errors)
        form.save()
        self.user.refresh_from_db()
        self.assertEqual(self.user.password, original)
        self.assertEqual(self.client.get("/api/current-user/", **headers).status_code, 200)
        form = self.form({"username": self.user.username, "password": "changed-password", "valid_until": "", "contract_month": "current"}, self.user)
        self.assertTrue(form.is_valid(), form.errors)
        form.save()
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password("changed-password"))
        self.assertNotEqual(self.client.get("/api/current-user/", **headers).status_code, 200)

    @patch("backend.views.KiteConnect")
    def test_app_users_cannot_read_or_replace_shared_broker_credentials(self, broker):
        headers = self.headers()
        response = self.client.get("/api/broker-token/", **headers)
        self.assertNotIn("dummy-token", response.content.decode())
        self.assertNotIn("access_token", response.content.decode())
        response = self.client.post("/api/set-access-token/", {"requestToken": "anything"}, **headers)
        self.assertEqual(response.status_code, 403)
        broker.assert_not_called()
        self.kite.refresh_from_db()
        self.assertEqual(self.kite.access_token, "dummy-token")

    def test_browsers_cannot_overwrite_or_add_shared_history(self):
        record = MarketSnapshot.objects.create(index_key="nifty", symbol="NIFTY26OCTFUT",
            bucket_time=dt.datetime(2026, 10, 5, 10), index_level=25000, net_lots=100, source="backend")
        data = {"snapshots": [{"key": "nifty", "symbol": record.symbol, "contractMonth": "current",
                              "time": 1791174600000, "indexLevel": 1, "netLots": 999999}]}
        response = self.client.post("/api/snapshots/save/", json.dumps(data), content_type="application/json", **self.headers())
        self.assertEqual(response.status_code, 403)
        record.refresh_from_db()
        self.assertEqual((record.index_level, record.net_lots, MarketSnapshot.objects.count()), (25000, 100, 1))

    @patch("frontend.views.KiteConnect")
    def test_callback_requires_admin_session_and_matching_one_time_state(self, broker):
        response = self.client.get("/?request_token=dummy&state=test-state")
        self.assertEqual(response.status_code, 400)
        broker.assert_not_called()
        staff = get_user_model().objects.create_superuser(username="oauth-admin", password="test-password")
        self.client.force_login(staff)
        session = self.client.session
        session["kite_oauth_state"] = "test-state"
        session["kite_oauth_started"] = timezone.now().timestamp()
        session.save()
        self.assertEqual(self.client.get("/?request_token=dummy&state=wrong").status_code, 400)
        broker.assert_not_called()
        broker.return_value.generate_session.return_value = {"access_token": "new-dummy-token"}
        self.assertEqual(self.client.get("/?request_token=dummy&state=test-state").status_code, 200)
        self.kite.refresh_from_db()
        self.assertEqual(self.kite.access_token, "new-dummy-token")
        self.assertNotIn("kite_oauth_state", self.client.session)
        self.assertEqual(self.client.get("/?request_token=dummy&state=test-state").status_code, 400)
        self.assertEqual(broker.return_value.generate_session.call_count, 1)


class SharedMarketFeedTests(TestCase):
    def setUp(self):
        self.credentials = KiteSettings.objects.create(api_key="dummy-key", api_secret="dummy-secret", access_token="dummy-token")
        self.factory = Mock(side_effect=lambda *args, **kwargs: Mock(MODE_FULL="full"))
        self.feed = SharedMarketFeed(lambda callback: callback(), ticker_factory=self.factory)
        frame = patch("backend.live_feed.get_master_contract", return_value=instrument_frame())
        frame.start()
        self.addCleanup(frame.stop)
        self.assertTrue(self.feed.renew_lease())

    def connect(self):
        self.feed.configure()
        ticker = self.feed.ticker
        self.feed.on_connect(ticker, {})
        return ticker

    def test_only_one_worker_can_hold_the_database_lease(self):
        other = SharedMarketFeed(lambda callback: callback(), ticker_factory=self.factory)
        self.assertFalse(other.renew_lease())
        LiveMarketFeed.objects.filter(pk=1).update(lease_until=time.time() - 1)
        self.assertTrue(other.renew_lease())
        self.assertFalse(self.feed.renew_lease())
        self.assertEqual(self.feed.publish(), 0)
        self.factory.assert_not_called()

    def test_same_configuration_uses_one_connection_for_all_months(self):
        ticker = self.connect()
        for _ in range(5):
            self.feed.configure()
        self.assertEqual(self.factory.call_count, 1)
        self.assertEqual(len(self.feed.tokens), 12)
        self.assertEqual(set(self.feed.contracts), {"current", "next", "far"})
        ticker.subscribe.assert_called_once_with(self.feed.tokens)

    def test_token_rotation_replaces_connection_and_ignores_old_callbacks(self):
        old = self.connect()
        self.feed.on_ticks(old, [{"instrument_token": 101, "last_price": 25000}])
        self.credentials.access_token = "new-dummy-token"
        self.credentials.save()
        self.feed.configure()
        old.close.assert_called_once()
        new = self.feed.ticker
        self.feed.on_connect(new, {})
        self.feed.on_ticks(new, [{"instrument_token": 101, "last_price": 25001}])
        self.feed.on_ticks(old, [{"instrument_token": 101, "last_price": 1}])
        self.feed.on_close(old)
        self.assertTrue(self.feed.connected)
        self.assertEqual(self.feed.ticks["101"]["last_price"], 25001)
        self.assertEqual(self.factory.call_count, 2)
        self.assertEqual(self.factory.call_args.args[1], "new-dummy-token")

    def test_disconnect_clears_quotes_and_sdk_reconnect_resubscribes(self):
        ticker = self.connect()
        self.feed.on_ticks(ticker, [{"instrument_token": 101, "last_price": 25000}])
        self.feed.on_close(ticker)
        self.feed.publish()
        self.assertEqual(LiveMarketFeed.objects.get(pk=1).payload["ticks"], {})
        self.feed.on_connect(ticker, {})
        self.feed.on_ticks(ticker, [{"instrument_token": 101, "last_price": 25010}])
        self.feed.publish()
        self.assertEqual(ticker.subscribe.call_count, 2)
        self.assertEqual(LiveMarketFeed.objects.get(pk=1).payload["status"], "live")

    def test_exhausted_sdk_retries_can_restart_and_missing_credentials_disconnect(self):
        ticker = self.connect()
        self.feed.on_noreconnect(ticker)
        self.feed.configure()
        self.assertEqual(self.factory.call_count, 2)
        self.credentials.access_token = ""
        self.credentials.save()
        self.feed.configure()
        self.assertIsNone(self.feed.ticker)

    def test_only_public_numeric_quote_fields_are_published(self):
        ticker = self.connect()
        self.feed.on_ticks(ticker, [{"instrument_token": 101, "last_price": 25000,
                                    "access_token": "secret", "oi": float("nan"),
                                    "ohlc": {"close": 24900, "private": "secret"}}])
        self.feed.publish()
        payload = LiveMarketFeed.objects.get(pk=1).payload
        self.assertNotIn("secret", json.dumps(payload))
        self.assertNotIn("access_token", json.dumps(payload))
        self.assertNotIn("oi", payload["ticks"]["101"])

    def test_browser_reads_share_cached_feed_and_respect_selected_month(self):
        ticker = self.connect()
        self.feed.on_ticks(ticker, [
            {"instrument_token": 101, "last_price": 25000},
            *[{"instrument_token": token, "last_price": 25100 + i} for i, token in enumerate([1000, 1001, 1002])],
        ])
        self.feed.publish()
        with patch("backend.views.protected", return_value=[{}, SimpleNamespace(contract_month="current")]):
            for month, price in zip(["current", "next", "far"], [25100, 25101, 25102]):
                for _ in range(5):
                    request = RequestFactory().get("/api/market-data/", {"contractMonth": month})
                    response = market_data(request)
                    payload = json.loads(response.content)
                    self.assertEqual(payload["quotes"]["nifty"]["last_price"], price)
                    self.assertEqual(payload["spotPrices"]["nifty"], 25000)
                    self.assertNotIn("dummy-token", response.content.decode())
                    self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(self.factory.call_count, 1)

    def test_stopped_or_stale_worker_never_returns_old_prices(self):
        ticker = self.connect()
        self.feed.on_ticks(ticker, [{"instrument_token": 101, "last_price": 25000}])
        self.feed.publish()
        LiveMarketFeed.objects.filter(pk=1).update(updated_at=timezone.now() - dt.timedelta(seconds=11))
        with patch("backend.views.protected", return_value=[{}, SimpleNamespace(contract_month="current")]):
            payload = json.loads(market_data(RequestFactory().get("/api/market-data/")).content)
        self.assertEqual(payload["feedStatus"], "offline")
        self.assertEqual(payload["quotes"], {})
        self.assertIsNone(payload["spotPrices"]["nifty"])


class SnapshotMonthIsolationTests(TestCase):
    def test_shared_options_are_saved_for_every_selected_month(self):
        KiteSettings.objects.create(api_key="dummy-key", access_token="dummy-token")
        now = dt.datetime(2026, 10, 5, 10, tzinfo=ZoneInfo("Asia/Kolkata"))
        futures = {
            (month, "nifty"): {"tradingsymbol": f"NIFTY{month}FUT", "exchange": "NFO",
                              "expiry": dt.date(2026, 10, 27), "instrument_type": "FUT", "lot_size": 25}
            for month in ["current", "next", "far"]
        }
        options = [{"tradingsymbol": "NIFTYOPTION" + side, "exchange": "NFO",
                    "instrument_type": side, "lot_size": 25, "strike": 25000} for side in ["CE", "PE"]]
        quote = {"last_price": 25000, "buy_quantity": 1000, "sell_quantity": 900, "volume": 10000}
        with patch("backend.snapshot_recorder.dt") as clock, patch("backend.snapshot_recorder.get_master_contract"), \
                patch("backend.snapshot_recorder.resolve_contract_rows", return_value=futures), \
                patch("backend.snapshot_recorder.resolve_atm_option_rows", return_value=options), \
                patch("backend.snapshot_recorder.KiteConnect") as broker, patch("backend.snapshot_recorder.log"):
            clock.datetime.now.return_value = now
            broker.return_value.quote.side_effect = lambda *symbols: {symbol: quote for symbol in symbols}
            record_market_snapshot()
            self.assertEqual(len(broker.return_value.quote.call_args.args), 2)
        for month in ["current", "next", "far"]:
            self.assertEqual(MarketSnapshot.objects.filter(contract_month=month, instrument_type__in=["CE", "PE"]).count(), 2)
        self.assertEqual(MarketSnapshot.objects.count(), 9)

import datetime as dt
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory, SimpleTestCase, TestCase

from .admin import TickerUserAdmin
from . import acdd_analyzer
from .instruments import resolve_spot_tokens
from .master_contract_updater import fetch_master_contract
from .market_contracts import market_today, resolve_atm_option_rows, resolve_contracts
from .models import MarketSnapshot, User as TickerUser
from .views import get_ins_token, snapshot_payload


class TickerUserAdminPermissionTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.model_admin = TickerUserAdmin(TickerUser, admin.site)
        self.auth_user_model = get_user_model()

    def request_for(self, user):
        request = self.factory.get("/admin/backend/user/")
        request.user = user
        return request

    def test_superuser_can_manage_ticker_users(self):
        superuser = self.auth_user_model.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="password",
        )
        request = self.request_for(superuser)

        self.assertTrue(self.model_admin.has_module_permission(request))
        self.assertTrue(self.model_admin.has_view_permission(request))
        self.assertTrue(self.model_admin.has_add_permission(request))
        self.assertTrue(self.model_admin.has_change_permission(request))
        self.assertTrue(self.model_admin.has_delete_permission(request))

    def test_staff_user_cannot_manage_ticker_users(self):
        staff_user = self.auth_user_model.objects.create_user(
            username="staff",
            email="staff@example.com",
            password="password",
            is_staff=True,
        )
        request = self.request_for(staff_user)

        self.assertFalse(self.model_admin.has_module_permission(request))
        self.assertFalse(self.model_admin.has_view_permission(request))
        self.assertFalse(self.model_admin.has_add_permission(request))
        self.assertFalse(self.model_admin.has_change_permission(request))
        self.assertFalse(self.model_admin.has_delete_permission(request))


class AtmOptionResolverTests(TestCase):
    def option_row(self, expiry, strike, option_type):
        return {
            "name": "NIFTY",
            "instrument_type": option_type,
            "expiry": expiry,
            "strike": float(strike),
            "tradingsymbol": f"NIFTY{expiry:%d%b%y}{int(strike)}{option_type}".upper(),
            "lot_size": 75,
        }

    def frame_for(self, rows):
        return pd.DataFrame(rows)

    def test_resolver_uses_later_expiry_when_nearest_chain_is_sparse(self):
        today = pd.Timestamp(market_today())
        sparse_expiry = today + pd.Timedelta(days=7)
        good_expiry = today + pd.Timedelta(days=14)
        rows = [
            self.option_row(sparse_expiry, 19000, "CE"),
            self.option_row(sparse_expiry, 19000, "PE"),
            self.option_row(sparse_expiry, 19100, "CE"),
            self.option_row(sparse_expiry, 19100, "PE"),
            self.option_row(good_expiry, 24950, "CE"),
            self.option_row(good_expiry, 24950, "PE"),
            self.option_row(good_expiry, 25000, "CE"),
            self.option_row(good_expiry, 25000, "PE"),
            self.option_row(good_expiry, 25050, "CE"),
            self.option_row(good_expiry, 25050, "PE"),
        ]

        selected = resolve_atm_option_rows(
            self.frame_for(rows),
            "NIFTY",
            good_expiry,
            25020,
        )

        self.assertEqual([row["strike"] for row in selected], [25000.0, 25000.0])
        self.assertEqual({row["instrument_type"] for row in selected}, {"CE", "PE"})

    def test_resolver_returns_no_rows_when_every_chain_is_far_from_atm(self):
        today = pd.Timestamp(market_today())
        expiry = today + pd.Timedelta(days=7)
        rows = [
            self.option_row(expiry, 19000, "CE"),
            self.option_row(expiry, 19000, "PE"),
            self.option_row(expiry, 19100, "CE"),
            self.option_row(expiry, 19100, "PE"),
        ]

        selected = resolve_atm_option_rows(
            self.frame_for(rows),
            "NIFTY",
            expiry,
            25020,
        )

        self.assertEqual(selected, [])


class AcDdAnalyzerAtmFilterTests(TestCase):
    def setUp(self):
        self.day = dt.date(2026, 10, 5)
        start = dt.datetime.combine(self.day, dt.time.min)
        clock = patch("backend.acdd_analyzer._today_bounds", return_value=(start, start + dt.timedelta(days=1)))
        clock.start()
        self.addCleanup(clock.stop)

    def create_snapshot(self, **overrides):
        defaults = {
            "index_key": "nifty",
            "contract_month": "current",
            "symbol": "NIFTY26JUNFUT",
            "instrument_type": "FUT",
            "bucket_time": dt.datetime.combine(self.day, dt.time(9, 20)),
            "index_level": 25020.0,
            "net_lots": 0.0,
            "volume_traded": 1000.0,
            "interval_volume": 100.0,
        }
        defaults.update(overrides)
        return MarketSnapshot.objects.create(**defaults)

    def test_today_option_points_ignore_far_strikes_when_future_baseline_exists(self):
        bucket_time = dt.datetime.combine(self.day, dt.time(9, 20))
        self.create_snapshot(
            symbol="NIFTY26JUNFUT",
            instrument_type="FUT",
            bucket_time=bucket_time,
            index_level=25020.0,
            strike=None,
        )
        self.create_snapshot(
            symbol="NIFTY2661625000CE",
            instrument_type="CE",
            bucket_time=bucket_time,
            index_level=120.0,
            strike=25000.0,
        )
        self.create_snapshot(
            symbol="NIFTY2661619000CE",
            instrument_type="CE",
            bucket_time=bucket_time,
            index_level=6200.0,
            strike=19000.0,
        )

        points = acdd_analyzer._load_today_option_points("current")
        symbols = [point["symbol"] for point in points["nifty"]]

        self.assertEqual(symbols, ["NIFTY2661625000CE"])


class MarketSnapshotPayloadTests(TestCase):
    def test_snapshot_payload_includes_demand_supply_ratio(self):
        snapshot = MarketSnapshot.objects.create(
            index_key="nifty",
            contract_month="current",
            symbol="NIFTY26JUNFUT",
            instrument_type="FUT",
            bucket_time=dt.datetime.combine(market_today(), dt.time(9, 20)),
            index_level=25020.0,
            net_lots=125.0,
            demand_supply_ratio=1.42,
        )

        payload = snapshot_payload(snapshot)

        self.assertEqual(payload["ratio"], 1.42)


def instrument_frame():
    rows = []
    for index, (exchange, symbol) in enumerate([
        ("NSE", "NIFTY 50"), ("NSE", "NIFTY BANK"), ("BSE", "SENSEX")
    ]):
        rows.append(dict(exchange=exchange, tradingsymbol=symbol, segment="INDICES",
                         instrument_token=101 + index, instrument_type="EQ", lot_size=0))
    for index, name in enumerate(["NIFTY", "BANKNIFTY", "SENSEX"]):
        for month in range(3):
            rows.append(dict(exchange="BFO" if name == "SENSEX" else "NFO",
                             tradingsymbol=f"{name}{month}FUT", name=name,
                             segment="BFO-FUT" if name == "SENSEX" else "NFO-FUT",
                             instrument_token=1000 + index * 10 + month, instrument_type="FUT",
                             lot_size=25, expiry=pd.Timestamp.today().normalize() + pd.DateOffset(months=month + 1)))
        for side, option_type in enumerate(["CE", "PE"]):
            rows.append(dict(exchange="BFO" if name == "SENSEX" else "NFO",
                             tradingsymbol=f"{name}TEST{option_type}", name=name,
                             segment="BFO-OPT" if name == "SENSEX" else "NFO-OPT",
                             instrument_token=2000 + index * 10 + side, instrument_type=option_type,
                             lot_size=25, expiry=pd.Timestamp.today().normalize() + pd.DateOffset(months=1)))
    # A similarly named tradable security must never supply the spot index.
    rows.insert(0, dict(exchange="BSE", tradingsymbol="NIFTY 50", segment="BSE",
                        instrument_token=999, instrument_type="EQ", lot_size=1))
    return pd.DataFrame(rows)


class SpotInstrumentTests(SimpleTestCase):
    def test_spot_resolution_uses_exchange_symbol_and_index_segment(self):
        self.assertEqual(resolve_spot_tokens(instrument_frame()),
                         {"nifty": 101, "banknifty": 102, "sensex": 103})

    def test_old_futures_only_cache_returns_missing_spot_tokens(self):
        frame = instrument_frame()
        self.assertEqual(resolve_spot_tokens(frame[frame.instrument_type == "FUT"]),
                         {"nifty": None, "banknifty": None, "sensex": None})

    @patch("backend.master_contract_updater.log")
    @patch("backend.master_contract_updater.r.get")
    def test_daily_refresh_keeps_spot_indices_futures_and_index_options(self, get, log):
        response = Mock(text=instrument_frame().to_csv(index=False))
        get.return_value = response
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "instruments.csv"
            with patch("backend.master_contract_updater.master_contract_path", return_value=path):
                fetch_master_contract()
            saved_frame = pd.read_csv(path)
        self.assertEqual(len(saved_frame), 18)
        self.assertEqual(resolve_spot_tokens(saved_frame), {"nifty": 101, "banknifty": 102, "sensex": 103})
        self.assertEqual((saved_frame.instrument_type == "FUT").sum(), 9)
        self.assertEqual(saved_frame.instrument_type.isin(["CE", "PE"]).sum(), 6)

    @patch("backend.views.get_master_contract")
    @patch("backend.market_contracts.get_master_contract")
    @patch("backend.views.protected", return_value=[{}, SimpleNamespace()])
    def test_tokens_api_supplies_the_same_spot_indices_for_each_month(self, protected, read, spot_read):
        read.return_value = spot_read.return_value = instrument_frame()
        for month_index, month in enumerate(["current", "next", "far"]):
            contracts = resolve_contracts(month)
            names = [contract["symbol"] for contract in contracts.values()]
            request = RequestFactory().get("/api/ins-token/", {"instruments": " ".join(names)})
            response = get_ins_token(request)
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.content)
            self.assertEqual(data["spotTokens"], {"nifty": 101, "banknifty": 102, "sensex": 103})
            for index, name in enumerate(["NIFTY", "BANKNIFTY", "SENSEX"]):
                self.assertEqual(data["tokens"][f"{name}{month_index}FUT"], 1000 + index * 10 + month_index)
                self.assertEqual(data["lots"][f"{name}{month_index}FUT"], 25)

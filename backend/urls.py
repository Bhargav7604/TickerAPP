from django.urls import path

from . import views
from . import equity, oi_analysis

urlpatterns = [
    path("index-options/contracts/", equity.contracts, {"index_options": True}, name="index_option_contracts"),
    path("index-options/quotes/", equity.quotes, {"index_options": True}, name="index_option_quotes"),
    path("index-options/history/", equity.history, {"index_options": True}, name="index_option_history"),
    path("oi/expiries/", oi_analysis.oi_expiries, name="oi_expiries"),
    path("oi/chain/", oi_analysis.oi_chain, name="oi_chain"),
    path("oi/live-chain/", oi_analysis.oi_live_chain, name="oi_live_chain"),
    path("oi/trend/", oi_analysis.oi_trend, name="oi_trend"),
    path("equity/contracts/", equity.contracts, name="equity_contracts"),
    path("equity/quotes/", equity.quotes, name="equity_quotes"),
    path("equity/history/", equity.history, name="equity_history"),
    path("health/", views.health, name="health"),
    path("login/", views.login_view, name="login"),
    path("current-user/", views.current_user, name="current_user"),
    path("set-access-token/", views.set_access_token, name="set_access_token"),
    path("broker-token/", views.broker_token, name="broker_token"),
    path("market-data/", views.market_data, name="market_data"),
    path("ins-token/", views.get_ins_token, name="get_ins_token"),
    path("snapshots/", views.get_snapshots, name="get_snapshots"),
    path("snapshots/heartbeat/", views.snapshot_heartbeat, name="snapshot_heartbeat"),
    path("snapshots/save/", views.save_snapshots, name="save_snapshots"),
    path("acdd/signals/", views.acdd_signals, name="acdd_signals"),
    path("settings/", views.get_settings, name="get_settings"),
    path("settings/save/", views.save_settings, name="save_settings"),
    path("settings/columns/", views.save_market_columns, name="save_market_columns"),
    path("alerts/send/", views.send_lot_swing_alert, name="send_lot_swing_alert"),
    # path("trades/", views.get_trades, name="get_trades"),
    # path("backtester/stop/", views.stop_backtester, name="stop_backtester"),
    # path("backtester/start/", views.start_backtester, name="start_backtester"),
    # path("backtester/status/", views.backtester_status, name="backtester_status")
]

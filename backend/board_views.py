"""Read-only API for the Market, Money Flow, Intraday and Tools pages. The market-feed worker does the work."""
import datetime as dt
import threading

import pandas as pd
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .board_tracker import SCANNER_IDS, SESSION_CLOSE, SESSION_OPEN, SNAPSHOT_ID
from .board_universe import universe
from .equity import HISTORY_CACHE_ID, broker, cache_retry_ms, cached_broker_result
from .market_contracts import MARKET_TZ, get_master_contract
from .models import LiveMarketFeed
from .views import protected

STALE_SECONDS = 30
CANDLE_TTL = 60
# Remaining NSE/BSE trading holidays; refresh this list from the exchange circular each December.
MARKET_HOLIDAYS = {"2026-11-24": "Guru Nanak Jayanti", "2026-12-25": "Christmas"}
OPTION_INDICES = (("NIFTY", "NFO"), ("BANKNIFTY", "NFO"), ("FINNIFTY", "NFO"), ("MIDCPNIFTY", "NFO"), ("SENSEX", "BFO"))
_calendar = {"key": None, "value": None}
_calendar_lock = threading.Lock()


def expiry_calendar(frame, today):
    """Next expiries and lot size of each index's options, straight from Zerodha's instrument list."""
    rows = []
    for name, exchange in OPTION_INDICES:
        options = frame[frame["name"].eq(name) & frame["exchange"].eq(exchange) & frame["segment"].eq(exchange + "-OPT")
                        & (frame["expiry"] >= pd.Timestamp(today))]
        if options.empty:
            continue
        dates = sorted(options["expiry"].dt.date.unique())
        lot = int(options[options["expiry"].dt.date.eq(dates[0])]["lot_size"].iloc[0])
        weekly = len(dates) > 1 and (dates[1] - dates[0]).days <= 8
        rows.append({"index": name, "cycle": "Weekly" if weekly else "Monthly", "lot": lot,
                     "next": [date.isoformat() for date in dates[:4]], "daysTo": (dates[0] - today).days})
    return rows


def cached_calendar(today):
    frame = get_master_contract()
    key = (id(frame), today)
    with _calendar_lock:
        if _calendar["key"] == key:
            return _calendar["value"]
    value = expiry_calendar(frame, today)
    with _calendar_lock:
        _calendar.update(key=key, value=value)
    return value


def published(pk):
    row = LiveMarketFeed.objects.filter(pk=pk).values("payload", "updated_at").first()
    if not row or not row["payload"]:
        return None, None
    return row["payload"], (timezone.now() - row["updated_at"]).total_seconds()


@gzip_page
@never_cache
@require_GET
def board_snapshot(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    today = dt.datetime.now(MARKET_TZ).date()
    try:
        calendar = cached_calendar(today)
    except Exception:
        calendar = []
    extra = {"calendar": calendar, "holidays": MARKET_HOLIDAYS}
    payload, age = published(SNAPSHOT_ID)
    if payload is None:
        return JsonResponse({"type": "success", "status": "offline", "rows": [], "fields": [], "indices": [], **extra,
                             "message": "Market data is starting up. Prices appear once Zerodha is connected."})
    if age > STALE_SECONDS:
        payload = {**payload, "status": "stale",
                   "message": "The market feed has paused. Showing the last prices received; they refresh when it reconnects."}
    return JsonResponse({"type": "success", "message": "", **payload, **extra})


@gzip_page
@never_cache
@require_GET
def board_scanner(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        size = int(request.GET.get("bars", 3))
    except ValueError:
        size = 0
    if size not in SCANNER_IDS:
        return JsonResponse({"type": "error", "message": "Choose 1, 3 or 5-minute bars."}, status=400)
    payload, age = published(SCANNER_IDS[size])
    if payload is None:
        return JsonResponse({"type": "success", "rows": [], "bars": size,
                             "message": "The scanner starts a minute after market data arrives."})
    return JsonResponse({"type": "success", "message": "", **payload, "stale": age > 120})


def candles_payload(symbol, now=None):
    """Three-minute candles of one board stock for the session on screen, for its stock card."""
    now = now or dt.datetime.now(MARKET_TZ)
    stock = next((stock for stock in universe(now)[0] if stock["symbol"] == symbol), None)
    if stock is None:
        return None
    client, session = broker()
    if not client:
        return {"symbol": symbol, "candles": [], "message": "Connect Zerodha to load the chart."}
    snapshot, _ = published(SNAPSHOT_ID)
    day = dt.date.fromisoformat(snapshot["session"]) if snapshot and snapshot.get("session") else now.date()
    start = dt.datetime.combine(day, SESSION_OPEN)
    end = min(now.astimezone(MARKET_TZ).replace(tzinfo=None), dt.datetime.combine(day, SESSION_CLOSE))
    key = f"bd|{symbol}|{day.isoformat()}"

    def fetch(_):
        rows = client.historical_data(stock["token"], start, end, "3minute") if end > start else []
        return {key: [{"time": int((row["date"] if row["date"].tzinfo else row["date"].replace(tzinfo=MARKET_TZ)).timestamp()),
                       "open": row["open"], "high": row["high"], "low": row["low"], "close": row["close"]} for row in rows]}

    entries = cached_broker_result(HISTORY_CACHE_ID, session, [key], CANDLE_TTL, fetch)
    return {"symbol": symbol, "session": day.isoformat(), "candles": (entries.get(key) or {}).get("data") or [],
            "retryAfterMs": cache_retry_ms(HISTORY_CACHE_ID, entries, [key], CANDLE_TTL), "message": "" if key in entries else "Loading chart."}


@never_cache
@require_GET
def board_candles(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    symbol = request.GET.get("symbol", "").upper()[:30]
    try:
        payload = candles_payload(symbol)
    except Exception:
        return JsonResponse({"type": "error", "message": "Chart unavailable right now. Please try again shortly."}, status=503)
    if payload is None:
        return JsonResponse({"type": "error", "message": "Choose a NIFTY 500 or F&O stock."}, status=400)
    return JsonResponse({"type": "success", "message": "", **payload})

"""Live dashboard: index and commodity futures, India VIX and USD/INR charts on one screen.

Contracts roll over by themselves: each chart picks the nearest unexpired future from the master contract.
Prices share the rate-limited quote cache and candles the history cache with the other screens.
"""

import datetime as dt

import pandas as pd
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .equity import HISTORY_CACHE_ID, QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result, failure, number
from .index_stocks import percent, positive, quote_batches, rounded
from .market_contracts import MARKET_TZ, get_master_contract, market_today
from .views import protected

KEY_PREFIX = "db|"
QUOTE_TTL = 3
HISTORY_TTL = 60
# id: (label, "EXCHANGE:SYMBOL" or (exchange, name, monthly contracts only))
CHARTS = {
    "nifty-fut": ("Nifty 50 Futures", ("NFO", "NIFTY", True)),
    "banknifty": ("Bank Nifty", "NSE:NIFTY BANK"),
    "india-vix": ("India VIX", "NSE:INDIA VIX"),
    "crude-oil": ("Crude Oil", ("MCX", "CRUDEOIL", False)),
    "usd-inr": ("USD / INR", ("CDS", "USDINR", True)),
}
# Days of history per candle size: enough candles to fill a chart without slowing it down.
INTERVALS = {"minute": 2, "5minute": 5, "15minute": 15, "60minute": 45, "day": 365}


def instrument(chart_id):
    spec = CHARTS[chart_id][1]
    if isinstance(spec, str):
        return spec
    exchange, name, monthly = spec
    frame = get_master_contract()
    rows = frame[(frame["exchange"] == exchange) & (frame["name"] == name) & (frame["instrument_type"] == "FUT")
                 & (frame["expiry"] >= pd.Timestamp(market_today()))]
    if monthly:
        # USDINR also has weekly futures (USDINR26N13FUT); the monthly one is what traders watch.
        rows = rows[rows["tradingsymbol"].str.fullmatch(r"[A-Z]+\d{2}[A-Z]{3}FUT")]
    if rows.empty:
        return None
    return f"{exchange}:{rows.sort_values('expiry').iloc[0]['tradingsymbol']}"


def trade_time(quote):
    value = quote.get("last_trade_time") or quote.get("timestamp")
    if not isinstance(value, dt.datetime) or value.year < 2000:
        return None
    return int((value if value.tzinfo else value.replace(tzinfo=MARKET_TZ)).timestamp())


def dashboard_quote(quote):
    ohlc = quote.get("ohlc") or {}
    return {"ltp": positive(quote.get("last_price")), "close": positive(ohlc.get("close")), "open": positive(ohlc.get("open")),
            "high": positive(ohlc.get("high")), "low": positive(ohlc.get("low")), "token": quote.get("instrument_token"),
            "tradedAt": trade_time(quote)}


def cached_quotes(client, session, names, ttl=QUOTE_TTL):
    keys = [KEY_PREFIX + name for name in names]

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: dashboard_quote(quote) for name, quote in raw.items()}

    return keys, cached_broker_result(QUOTE_CACHE_ID, session, keys, ttl, fetch)


def quotes_payload():
    names = {chart_id: instrument(chart_id) for chart_id in CHARTS}
    client, session = broker()
    entries, retry = {}, None
    if client:
        keys, entries = cached_quotes(client, session, [name for name in names.values() if name])
        retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, QUOTE_TTL)
    charts = []
    for chart_id, (label, _) in CHARTS.items():
        name = names[chart_id]
        quote = ((entries.get(KEY_PREFIX + name) or {}).get("data") or {}) if name else {}
        ltp, close = quote.get("ltp"), quote.get("close")
        charts.append({
            "id": chart_id, "label": label, "symbol": name.split(":", 1)[1] if name else None, "exchange": name.split(":", 1)[0] if name else None,
            "ltp": ltp, "close": close, "open": quote.get("open"), "high": quote.get("high"), "low": quote.get("low"),
            "change": rounded(ltp - close, 4) if ltp and close else None, "changePct": rounded(percent(ltp, close)), "tradedAt": quote.get("tradedAt"),
        })
    message = "" if client else "Live prices are not connected. Please try again in a few minutes."
    return {"charts": charts, "retryAfterMs": retry, "message": message}


def candles_payload(chart_id, interval, now=None):
    name = instrument(chart_id)
    if not name:
        return {"id": chart_id, "candles": [], "message": "This contract is not in today's contract list yet."}
    client, session = broker()
    if not client:
        return {"id": chart_id, "candles": [], "message": "Connect Zerodha to load the chart."}
    now = now or dt.datetime.now(MARKET_TZ)
    _, quotes = cached_quotes(client, session, [name], ttl=3600)
    token = ((quotes.get(KEY_PREFIX + name) or {}).get("data") or {}).get("token")
    if not token:
        return {"id": chart_id, "candles": [], "message": "Loading chart. Please wait.", "retryAfterMs": 1500}
    key = f"{KEY_PREFIX}{name}:{interval}:{now:%Y-%m-%d}"
    start = dt.datetime.combine(now.date() - dt.timedelta(days=INTERVALS[interval]), dt.time.min)

    def fetch(_):
        rows = client.historical_data(token, start, now.replace(tzinfo=None), interval)
        return {key: [{"time": int((row["date"] if row["date"].tzinfo else row["date"].replace(tzinfo=MARKET_TZ)).timestamp()),
                       "open": number(row.get("open")), "high": number(row.get("high")), "low": number(row.get("low")),
                       "close": number(row.get("close")), "volume": number(row.get("volume"))}
                      for row in rows if number(row.get("close")) is not None]}

    entries = cached_broker_result(HISTORY_CACHE_ID, session, [key], HISTORY_TTL, fetch)
    return {"id": chart_id, "symbol": name.split(":", 1)[1], "interval": interval, "candles": (entries.get(key) or {}).get("data") or [],
            "retryAfterMs": cache_retry_ms(HISTORY_CACHE_ID, entries, [key], HISTORY_TTL), "message": "" if key in entries else "Loading chart. Please wait."}


@never_cache
@require_GET
def dashboard_quotes(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        return JsonResponse({"type": "success", **quotes_payload()})
    except Exception:
        return failure("Live prices are unavailable right now. Please try again shortly.", 503)


@never_cache
@require_GET
def dashboard_candles(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    chart_id, interval = request.GET.get("id", ""), request.GET.get("interval", "5minute")
    if chart_id not in CHARTS or interval not in INTERVALS:
        return failure("Choose one of the dashboard charts and a candle size.")
    try:
        return JsonResponse({"type": "success", **candles_payload(chart_id, interval)})
    except Exception:
        return failure("Chart unavailable. Historical-data access or a fresh broker session may be required.", 503)

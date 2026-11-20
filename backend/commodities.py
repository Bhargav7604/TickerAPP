"""Commodities page: every MCX future live, grouped, with open interest against the previous session.

Contracts roll by themselves (near = nearest unexpired, next = the one after) from the master contract. Quotes
share the rate-limited quote cache with the other screens; the previous session's OI and range are fetched once a
day by the market-feed worker (refresh_commodity_stats) so a page request never waits on history calls.
"""
import datetime as dt
import time
from zoneinfo import ZoneInfo

import pandas as pd
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .board_universe import previous_candle, previous_oi, summarise_candles
from .equity import HISTORY_CACHE_ID, QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result, number
from .index_stocks import quote_batches
from .market_contracts import COMMODITY_NAMES, MARKET_TZ, get_master_contract
from .models import UniverseStats
from .views import protected

KEY_PREFIX = "cm|"
QUOTE_TTL = 2
HISTORY_TTL = 60
STATS_PREFIX = "MCX:"
CONTINUOUS_PREFIX = "MCXC:"  # a year of continuous daily history per headline commodity
CONTINUOUS_DAYS = 400
CONTINUOUS_KEEP = 260
STATS_PAUSE = 0.4
INTERVALS = {"minute": 2, "5minute": 5, "15minute": 15, "60minute": 45, "day": 365}
GROUPS = ("Bullion", "Energy", "Base metals", "Agri", "Indices", "Other")
HEADLINE = ("GOLD", "SILVER", "CRUDEOIL", "NATURALGAS", "COPPER")
# MCX name: (label, group, quoted per). Units are only given where the exchange's quotation is standard and well known.
COMMODITIES = {
    "GOLD": ("Gold", "Bullion", "₹/10 g"), "GOLDM": ("Gold Mini", "Bullion", "₹/10 g"), "GOLDTEN": ("Gold Ten", "Bullion", "₹/10 g"),
    "GOLDGUINEA": ("Gold Guinea", "Bullion", "₹/8 g"), "GOLDPETAL": ("Gold Petal", "Bullion", "₹/1 g"),
    "SILVER": ("Silver", "Bullion", "₹/kg"), "SILVERM": ("Silver Mini", "Bullion", "₹/kg"), "SILVERMIC": ("Silver Micro", "Bullion", "₹/kg"),
    "SILVER100": ("Silver 100", "Bullion", ""),
    "CRUDEOIL": ("Crude Oil", "Energy", "₹/bbl"), "CRUDEOILM": ("Crude Oil Mini", "Energy", "₹/bbl"),
    "NATURALGAS": ("Natural Gas", "Energy", "₹/mmBtu"), "NATGASMINI": ("Natural Gas Mini", "Energy", "₹/mmBtu"),
    "ELECDMBL": ("Electricity", "Energy", ""),
    "COPPER": ("Copper", "Base metals", "₹/kg"), "ZINC": ("Zinc", "Base metals", "₹/kg"), "ZINCMINI": ("Zinc Mini", "Base metals", "₹/kg"),
    "ALUMINIUM": ("Aluminium", "Base metals", "₹/kg"), "ALUMINI": ("Aluminium Mini", "Base metals", "₹/kg"),
    "LEAD": ("Lead", "Base metals", "₹/kg"), "LEADMINI": ("Lead Mini", "Base metals", "₹/kg"), "NICKEL": ("Nickel", "Base metals", "₹/kg"),
    "STEELREBAR": ("Steel Rebar", "Base metals", ""),
    "MENTHAOIL": ("Mentha Oil", "Agri", "₹/kg"), "COTTON": ("Cotton", "Agri", ""), "COTTONCNDY": ("Cotton Candy", "Agri", ""),
    "KAPAS": ("Kapas", "Agri", ""), "CARDAMOM": ("Cardamom", "Agri", ""), "COTTONOIL": ("Cotton Oil", "Agri", ""), "SUNOIL": ("Sunflower Oil", "Agri", ""),
    "MCXBULLDEX": ("MCX Bullion Index", "Indices", "points"), "MCXMETLDEX": ("MCX Metal Index", "Indices", "points"),
}


def describe(name):
    label, group, unit = COMMODITIES.get(name, (name.title(), "Other", ""))
    return {"name": name, "label": label, "group": group, "unit": unit}


def mcx_session(now):
    """MCX trades 09:00 to 23:30 IST while the US is on summer time and to 23:55 in the US winter."""
    local = now.astimezone(MARKET_TZ)
    us_summer = bool(local.astimezone(ZoneInfo("America/New_York")).dst())
    close = dt.time(23, 30) if us_summer else dt.time(23, 55)
    is_open = local.weekday() < 5 and dt.time(9, 0) <= local.time() <= close
    return {"open": is_open, "opensAt": "09:00", "closesAt": close.strftime("%H:%M")}


def contracts(frame, today, month="near"):
    """{name: master-contract row} for each MCX commodity's near or next unexpired future."""
    futures = frame[frame["exchange"].eq("MCX") & frame["segment"].eq("MCX-FUT") & frame["instrument_type"].eq("FUT")
                    & (frame["expiry"] >= pd.Timestamp(today))].sort_values("expiry")
    position = 0 if month == "near" else 1
    out = {}
    for name, rows in futures.groupby("name"):
        if len(rows) > position:
            out[name] = rows.iloc[position]
    return out


def buildup(change, oi_change):
    if change is None or oi_change is None:
        return None
    if change >= 0:
        return "LB" if oi_change >= 0 else "SC"
    return "SB" if oi_change >= 0 else "LU"


def trade_time(value):
    if not isinstance(value, dt.datetime) or value.year < 2000:
        return None
    return int((value if value.tzinfo else value.replace(tzinfo=MARKET_TZ)).timestamp())


def compact(quote):
    ohlc = quote.get("ohlc") or {}
    depth = quote.get("depth") or {}
    best = lambda side: next((level.get("price") for level in depth.get(side, []) if (level.get("price") or 0) > 0), None)
    positive = lambda value: number(value) if (number(value) or 0) > 0 else None
    return {"ltp": number(quote.get("last_price")), "open": positive(ohlc.get("open")), "high": positive(ohlc.get("high")),
            "low": positive(ohlc.get("low")), "close": positive(ohlc.get("close")), "volume": number(quote.get("volume")),
            "oi": number(quote.get("oi")), "vwap": positive(quote.get("average_price")), "bid": best("buy"), "ask": best("sell"),
            "lc": positive(quote.get("lower_circuit_limit")), "uc": positive(quote.get("upper_circuit_limit")),
            "buyQty": number(quote.get("buy_quantity")), "sellQty": number(quote.get("sell_quantity")),
            "tradedAt": trade_time(quote.get("last_trade_time")), "token": quote.get("instrument_token")}


def rounded(value, places=2):
    return round(value, places) if value is not None else None


def commodity_rows(selected, quotes, stats, today):
    rows = []
    for name, contract in sorted(selected.items(), key=lambda item: (GROUPS.index(describe(item[0])["group"]), item[0])):
        symbol = contract["tradingsymbol"]
        quote = quotes.get(symbol) or {}
        ltp, close = quote.get("ltp"), quote.get("close")
        change = ltp - close if ltp is not None and close else None
        session = dt.datetime.fromtimestamp(quote["tradedAt"], MARKET_TZ).date() if quote.get("tradedAt") else today
        stat = stats.get(STATS_PREFIX + symbol)
        prev_oi = previous_oi(stat.fut_oi, session) if stat else None
        oi_change = quote["oi"] - prev_oi if quote.get("oi") is not None and prev_oi else None
        prev = previous_candle(stat.recent, session) if stat else None
        expiry = contract["expiry"].date()
        rows.append({
            **describe(name), "symbol": symbol, "expiry": expiry.isoformat(), "daysToExpiry": (expiry - today).days,
            "ltp": ltp, "prevClose": close, "change": rounded(change), "changePct": rounded(change / close * 100) if change is not None else None,
            "open": quote.get("open"), "high": quote.get("high"), "low": quote.get("low"), "vwap": quote.get("vwap"),
            "volume": quote.get("volume"), "oi": quote.get("oi"), "prevOi": prev_oi, "oiChange": oi_change,
            "oiChangePct": rounded(oi_change / prev_oi * 100) if oi_change is not None else None,
            "buildup": buildup(change, oi_change), "bid": quote.get("bid"), "ask": quote.get("ask"),
            "lc": quote.get("lc"), "uc": quote.get("uc"), "tradedAt": quote.get("tradedAt"),
            "prevHigh": prev[2] if prev else None, "prevLow": prev[3] if prev else None, "prevSessionClose": prev[4] if prev else None,
        })
    return rows


def commodities_payload(month="near", now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    selected = contracts(get_master_contract(), today, month)
    base = {"month": month, "session": mcx_session(now), "rows": [], "headline": list(HEADLINE), "groups": list(GROUPS)}
    if not selected:
        return {**base, "message": "No MCX futures are in today's contract list yet."}
    client, session = broker()
    if not client:
        return {**base, "rows": commodity_rows(selected, {}, {}, today), "message": "Live prices are not connected. Please try again in a few minutes."}
    keys = [KEY_PREFIX + "MCX:" + row["tradingsymbol"] for row in selected.values()]

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: compact(quote) for name, quote in raw.items()}

    entries = cached_broker_result(QUOTE_CACHE_ID, session, keys, QUOTE_TTL, fetch)
    quotes = {key[len(KEY_PREFIX) + 4:]: (value or {}).get("data") or {} for key, value in entries.items()}
    stats = {row.symbol: row for row in UniverseStats.objects.filter(symbol__in=[STATS_PREFIX + row["tradingsymbol"] for row in selected.values()])}
    fetched = [entry["at"] for entry in entries.values() if entry.get("data")]
    rows = commodity_rows(selected, quotes, stats, today)
    priced = sum(1 for row in rows if row["ltp"] is not None)
    retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, QUOTE_TTL)
    return {**base, "rows": rows, "asOf": int(min(fetched)) if fetched else None, "retryAfterMs": retry,
            "message": "" if priced else ("Loading live prices..." if retry else "Live prices are not available right now.")}


def candles_payload(symbol, interval, now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    frame = get_master_contract()
    rows = frame[frame["exchange"].eq("MCX") & frame["segment"].eq("MCX-FUT") & frame["tradingsymbol"].eq(symbol)]
    if rows.empty:
        return None
    client, session = broker()
    if not client:
        return {"symbol": symbol, "candles": [], "message": "Connect Zerodha to load the chart."}
    token = int(rows.iloc[0]["instrument_token"])
    key = f"{KEY_PREFIX}{symbol}:{interval}:{now:%Y-%m-%d}"
    start = dt.datetime.combine(now.date() - dt.timedelta(days=INTERVALS[interval]), dt.time.min)

    def fetch(_):
        history = client.historical_data(token, start, now.astimezone(MARKET_TZ).replace(tzinfo=None), interval)
        return {key: [{"time": int((row["date"] if row["date"].tzinfo else row["date"].replace(tzinfo=MARKET_TZ)).timestamp()),
                       "open": number(row.get("open")), "high": number(row.get("high")), "low": number(row.get("low")),
                       "close": number(row.get("close")), "volume": number(row.get("volume"))}
                      for row in history if number(row.get("close")) is not None]}

    entries = cached_broker_result(HISTORY_CACHE_ID, session, [key], HISTORY_TTL, fetch)
    return {"symbol": symbol, "interval": interval, "candles": (entries.get(key) or {}).get("data") or [],
            "retryAfterMs": cache_retry_ms(HISTORY_CACHE_ID, entries, [key], HISTORY_TTL), "message": "" if key in entries else "Loading chart."}


def refresh_commodity_stats(client, now=None, pause=STATS_PAUSE):
    """Once a day: recent daily candles with open interest for each near and next MCX future (previous OI and range)."""
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    frame = get_master_contract()
    selected = list(contracts(frame, today, "near").values()) + list(contracts(frame, today, "next").values())
    fresh = set(UniverseStats.objects.filter(stats_on=today, symbol__startswith=STATS_PREFIX).values_list("symbol", flat=True))
    end = now.astimezone(MARKET_TZ).replace(tzinfo=None)
    saved = 0
    for contract in selected:
        symbol = STATS_PREFIX + contract["tradingsymbol"]
        if symbol in fresh:
            continue
        try:
            history = client.historical_data(int(contract["instrument_token"]), end - dt.timedelta(days=15), end, "day", oi=True)
            time.sleep(pause)
        except Exception as exc:
            if type(exc).__name__ in ("TokenException", "PermissionException"):
                break
            continue
        UniverseStats.objects.update_or_create(symbol=symbol, defaults={
            "stats_on": today, **summarise_candles(history, today), "fut_symbol": contract["tradingsymbol"],
            "fut_oi": {row["date"].date().isoformat(): row["oi"] for row in history if row.get("oi")}})
        saved += 1
    near = contracts(frame, today, "near")
    for name in COMMODITY_NAMES.values():
        symbol, contract = CONTINUOUS_PREFIX + name, near.get(name)
        if contract is None or symbol in fresh_continuous(today):
            continue
        try:
            # Zerodha stitches expired contracts together for daily futures history ("continuous").
            history = client.historical_data(int(contract["instrument_token"]), end - dt.timedelta(days=CONTINUOUS_DAYS), end, "day", continuous=True)
            time.sleep(pause)
        except Exception as exc:
            if type(exc).__name__ in ("TokenException", "PermissionException"):
                break
            continue
        stats = summarise_candles(history, today)
        rows = [[row["date"].date().isoformat() if hasattr(row["date"], "date") else str(row["date"])[:10],
                 row["open"], row["high"], row["low"], row["close"], row.get("volume") or 0] for row in history]
        UniverseStats.objects.update_or_create(symbol=symbol, defaults={
            **stats, "stats_on": today, "recent": rows[-CONTINUOUS_KEEP:], "fut_symbol": contract["tradingsymbol"], "fut_oi": {}})
        saved += 1
    return saved


def fresh_continuous(today):
    return set(UniverseStats.objects.filter(stats_on=today, symbol__startswith=CONTINUOUS_PREFIX).values_list("symbol", flat=True))


@gzip_page
@never_cache
@require_GET
def commodities_view(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    month = request.GET.get("month", "near")
    if month not in ("near", "next"):
        return JsonResponse({"type": "error", "message": "Choose the near or next month."}, status=400)
    try:
        return JsonResponse({"type": "success", **commodities_payload(month)})
    except Exception:
        return JsonResponse({"type": "error", "message": "Commodity prices are unavailable right now. Please try again shortly."}, status=503)


@never_cache
@require_GET
def commodity_candles(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    symbol, interval = request.GET.get("symbol", "").upper()[:40], request.GET.get("interval", "5minute")
    if interval not in INTERVALS:
        return JsonResponse({"type": "error", "message": "Choose a candle size of 1m, 5m, 15m, 1h or 1D."}, status=400)
    try:
        payload = candles_payload(symbol, interval)
    except Exception:
        return JsonResponse({"type": "error", "message": "Chart unavailable right now. Please try again shortly."}, status=503)
    if payload is None:
        return JsonResponse({"type": "error", "message": "Choose a current MCX futures contract."}, status=400)
    return JsonResponse({"type": "success", "message": "", **payload})

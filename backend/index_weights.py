"""Sector contribution: how many index points each sector adds to, or takes from, the index today.

Between rebalances an index is a fixed weighted sum of its stocks' prices, so each stock's weight can be
recovered from minute prices of the index and its stocks by least squares. The fit runs once each trading
morning on the last few complete sessions, and is only kept if the stocks reproduce the index closely.
"""

import datetime as dt
import time
from collections import defaultdict

import numpy as np
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .decision import market_open
from .equity import QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result
from .index_lists import PSU_BANKS
from .index_stocks import KEY_PREFIX, LABELS, QUOTE_TTL, compact_quote, percent, quote_batches, quote_name, rounded
from .logger import log
from .market_contracts import MARKET_TZ
from .models import IndexConstituent, IndexWeights
from .oi_recorder import SPOT_KEYS
from .views import protected

WEIGHT_INDEXES = ("nifty",)
FIT_DAYS = 9          # calendar days back: about six complete sessions
MIN_SESSIONS = 3
MIN_MINUTES = 600
MAX_FIT_ERROR = 5.0   # index points; a split or rebalance inside the window pushes the gap far above this
HISTORY_PAUSE = 0.4   # Kite allows three historical-data requests a second
INDEX = "__index"

# NSE industries grouped the way traders talk about them.
SECTOR_GROUPS = {
    "IT": "IT", "Auto": "Automobile", "Healthcare": "Pharma & Health", "FMCG": "FMCG", "Oil & Gas": "Energy & OMC",
    "Metals & Mining": "Metals & Mining", "Power": "Power & Utilities", "Telecom": "Telecom & Media", "Media": "Telecom & Media",
    "Construction Materials": "Cement & Materials", "Capital Goods": "Capital Goods & Infra", "Construction": "Capital Goods & Infra",
    "Consumer Durables": "Consumer & Retail", "Consumer Services": "Consumer & Retail", "Chemicals": "Chemicals",
    "Private Banks": "Banking", "PSU Banks": "Banking",
}
SYMBOL_GROUPS = {"ASIANPAINT": "Chemicals", "ADANIPORTS": "Capital Goods & Infra", "INDIGO": "Consumer & Retail"}
BANKS = PSU_BANKS | {"HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK", "FEDERALBNK", "IDFCFIRSTB", "AUBANK", "BANDHANBNK", "YESBANK"}


def contribution_sector(member):
    if member.symbol in SYMBOL_GROUPS:
        return SYMBOL_GROUPS[member.symbol]
    if member.sector == "Financial Services":
        return "Banking" if member.symbol in BANKS or "bank" in (member.company or "").lower() else "NBFC & Finance"
    return SECTOR_GROUPS.get(member.sector, member.sector or "Other")


def solve_weights(prices, level):
    """Index points per rupee for each stock (columns of prices), and the typical gap of the fit in points."""
    scale = prices.mean(axis=0)
    design = prices / scale
    weights = np.linalg.lstsq(design, level, rcond=None)[0]
    if (weights < 0).any():
        # A stock cannot pull an index the wrong way: project onto non-negative weights.
        weights = np.clip(weights, 0, None)
        step = 1 / np.linalg.norm(design, 2) ** 2
        for _ in range(20000):
            weights = np.clip(weights - step * (design.T @ (design @ weights - level)), 0, None)
    gap = float(np.sqrt(np.mean((design @ weights - level) ** 2)))
    return weights / scale, gap


def minute_closes(client, token, start, end):
    for attempt in range(2):
        try:
            return {row["date"].replace(tzinfo=None): row["close"] for row in client.historical_data(token, start, end, "minute")}
        except Exception:
            if attempt:
                raise
            time.sleep(1.5)


def refresh_index_weights(index_key="nifty", client=None, now=None, pause=HISTORY_PAUSE):
    """Fit today's weights once. Anything doubtful keeps the previous weights in place."""
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    if IndexWeights.objects.filter(index_key=index_key, computed_on=today).exists():
        return "fresh"
    if client is None:
        client, _ = broker()
        if not client:
            return "offline"
    members = {member.symbol: member for member in IndexConstituent.objects.filter(index_key=index_key)}
    if not members:
        return "no stocks"
    names = {quote_name(member): symbol for symbol, member in members.items()}
    names[SPOT_KEYS[index_key]] = INDEX
    tokens = {names[name]: quote["instrument_token"] for name, quote in client.ltp(list(names)).items() if name in names}
    if len(tokens) < len(names):
        log(f"Index weights for {index_key}: {len(names) - len(tokens)} instruments not found; keeping old weights.", "ERROR")
        return "missing instruments"
    start = dt.datetime.combine(today - dt.timedelta(days=FIT_DAYS), dt.time(9, 15))
    end = dt.datetime.combine(today, dt.time.min) - dt.timedelta(minutes=1)  # complete sessions only
    series = {}
    try:
        for key, token in tokens.items():
            series[key] = minute_closes(client, token, start, end)
            time.sleep(pause)
    except Exception as exc:
        log(f"Index weights for {index_key}: minute history unavailable ({type(exc).__name__}); keeping old weights.", "ERROR")
        return "history unavailable"
    symbols = sorted(members)
    minutes = sorted(set(series[INDEX]).intersection(*(series[symbol] for symbol in symbols)))
    sessions = len({minute.date() for minute in minutes})
    if sessions < MIN_SESSIONS or len(minutes) < MIN_MINUTES:
        return "not enough history"
    prices = np.array([[series[symbol][minute] for symbol in symbols] for minute in minutes])
    level = np.array([series[INDEX][minute] for minute in minutes])
    coefficients, gap = solve_weights(prices, level)
    total = float(prices[-1] @ coefficients / level[-1] * 100)
    if not np.isfinite(gap) or gap > MAX_FIT_ERROR or not 97 <= total <= 103:
        log(f"Index weights for {index_key} rejected (gap {gap:.2f} pts, weights {total:.1f}%); keeping old weights.", "ERROR")
        return "rejected"
    IndexWeights.objects.update_or_create(index_key=index_key, defaults={
        "computed_on": today, "sessions": sessions, "fit_error": round(gap, 3),
        "coefficients": {symbol: float(value) for symbol, value in zip(symbols, coefficients)}})
    log(f"Index weights for {index_key} saved from {sessions} sessions (gap {gap:.2f} pts).", "INFO")
    return "saved"


def refresh_all_index_weights():
    for index_key in WEIGHT_INDEXES:
        refresh_index_weights(index_key)


def contribution_payload(index_key, now=None):
    """Index points from each sector since yesterday's close: weight x price change, summed per sector."""
    now = now or dt.datetime.now(MARKET_TZ)
    base = {"index": index_key, "label": LABELS[index_key], "marketOpen": market_open(now), "sectors": []}
    weights = IndexWeights.objects.filter(index_key=index_key).first()
    if not weights:
        return {**base, "message": "Sector contribution appears after the morning weight update."}
    members = list(IndexConstituent.objects.filter(index_key=index_key))
    client, session = broker()
    if not client:
        return {**base, "message": "Live prices are not connected. Please try again in a few minutes."}
    cash_keys = {member.symbol: KEY_PREFIX + quote_name(member) for member in members}
    spot_key = KEY_PREFIX + SPOT_KEYS[index_key]
    keys = [spot_key, *cash_keys.values()]

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: compact_quote(quote) for name, quote in raw.items()}

    entries = cached_broker_result(QUOTE_CACHE_ID, session, keys, QUOTE_TTL, fetch)
    retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, QUOTE_TTL)

    def data(key):
        return (entries.get(key) or {}).get("data") or {}

    groups = defaultdict(list)
    for member in members:
        quote, coefficient = data(cash_keys[member.symbol]), weights.coefficients.get(member.symbol)
        if coefficient is None or quote.get("ltp") is None or not quote.get("close"):
            continue
        groups[contribution_sector(member)].append({
            "symbol": member.symbol, "points": round(coefficient * (quote["ltp"] - quote["close"]), 2),
            "changePct": rounded(percent(quote["ltp"], quote["close"]))})
    sectors = sorted(({"name": name, "points": round(sum(stock["points"] for stock in stocks), 1),
                       "stocks": sorted(stocks, key=lambda stock: -abs(stock["points"]))} for name, stocks in groups.items()),
                     key=lambda sector: -sector["points"])
    spot = data(spot_key)
    fetched = [entry["at"] for entry in entries.values() if entry.get("data")]
    return {
        **base, "sectors": sectors, "indexLevel": spot.get("ltp"),
        "indexMove": round(spot["ltp"] - spot["close"], 1) if spot.get("ltp") and spot.get("close") else None,
        "explained": round(sum(sector["points"] for sector in sectors), 1) if sectors else None,
        "weightsOn": weights.computed_on.isoformat(), "asOf": int(min(fetched)) if fetched else None, "retryAfterMs": retry,
        "message": "" if sectors else ("Loading live prices..." if retry else "Live prices are not available right now."),
    }


@never_cache
@require_GET
def index_contribution(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    index_key = request.GET.get("index", "nifty")
    if index_key not in WEIGHT_INDEXES:
        return JsonResponse({"type": "error", "message": "Sector contribution is available for NIFTY 50."}, status=400)
    try:
        return JsonResponse({"type": "success", **contribution_payload(index_key)})
    except Exception:
        return JsonResponse({"type": "error", "message": "Sector contribution is unavailable right now. Please try again shortly."}, status=503)

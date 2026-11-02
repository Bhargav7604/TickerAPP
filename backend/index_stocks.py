"""Index Stocks: how each stock inside NIFTY 50, BANK NIFTY and SENSEX is moving, in plain numbers.

Live prices come from one shared, rate-limited quote cache. Previous-session levels (pivots) and the
futures OI baseline come from daily candles saved once a day by refresh_stock_history.
"""

import csv
import datetime as dt
import io
import time
from collections import defaultdict

import requests
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .decision import market_open
from .equity import QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result, catalogue
from .index_lists import NSE_LISTS, sector_for
from .market_contracts import MARKET_TZ
from .models import IndexConstituent, StockDailyHistory
from .oi_analysis import buildup
from .oi_recorder import SPOT_KEYS
from .views import protected

LABELS = {"nifty": "NIFTY 50", "banknifty": "BANK NIFTY", "sensex": "SENSEX"}
HEATMAP_LABELS = {**LABELS, "nifty500": "NIFTY 500"}
HEATMAP_SPOTS = {**SPOT_KEYS, "nifty500": "NSE:NIFTY 500"}
KEY_PREFIX = "ix|"
QUOTE_TTL = 3
HEATMAP_TTL = 6
QUOTE_BATCH = 450  # Kite accepts up to 500 instruments per quote request
QUOTE_PAUSE = 1.05  # and one quote request a second
HISTORY_DAYS = 12
HISTORY_CALLS_PER_RUN = 45
HISTORY_PAUSE = 0.35  # Kite allows three historical-data requests a second.
BUILDUP_CODES = {"Long Build-up": "LB", "Short Build-up": "SB", "Short Covering": "SC", "Long Unwinding": "LU"}
BULLISH_BUILDUP = ("Long Build-up", "Short Covering")
BEARISH_BUILDUP = ("Short Build-up", "Long Unwinding")
STATE_MIN_CHECKS = 3


def positive(value):
    """Broker fields use 0 for 'not available'."""
    return float(value) if value else None


def rounded(value, places=2):
    return round(value, places) if value is not None else None


def percent(value, base):
    return (value - base) / base * 100 if value is not None and base else None


def quote_name(member):
    """Kite names non-EQ series with a suffix, e.g. NSE:EMBASSY-RR for a REIT or NSE:HFCL-BE for trade-for-trade."""
    series = getattr(member, "series", "") or "EQ"
    return f"NSE:{member.symbol}" if series == "EQ" else f"NSE:{member.symbol}-{series}"


def nearest_futures(symbols):
    """{symbol: (tradingsymbol, instrument_token)} for each stock's nearest-expiry future."""
    frame = catalogue()
    futures = frame[frame["instrument_type"].eq("FUT") & frame["name"].isin(list(symbols))].sort_values("expiry")
    first = futures.drop_duplicates("name")
    return {row["name"]: (row["tradingsymbol"], int(row["instrument_token"])) for _, row in first.iterrows()}


def quote_batches(client, names, pause=QUOTE_PAUSE):
    raw = {}
    for start in range(0, len(names), QUOTE_BATCH):
        if start:
            time.sleep(pause)
        raw.update(client.quote(names[start:start + QUOTE_BATCH]))
    return raw


def compact_quote(quote):
    ohlc = quote.get("ohlc") or {}
    traded = quote.get("last_trade_time") or quote.get("timestamp")
    return {"ltp": positive(quote.get("last_price")), "close": positive(ohlc.get("close")), "open": positive(ohlc.get("open")),
            "high": positive(ohlc.get("high")), "low": positive(ohlc.get("low")), "vwap": positive(quote.get("average_price")),
            "volume": quote.get("volume"), "oi": quote.get("oi"), "token": quote.get("instrument_token"),
            "tradeDate": traded.date().isoformat() if hasattr(traded, "date") else None}


def previous_candle(history, session_date):
    """The last complete daily candle before the session the live quote belongs to."""
    if not history:
        return None
    before = [candle for candle in history.candles if candle[0] < session_date]
    return before[-1] if before else None


def pivots(candle):
    """Classic floor pivots from the previous session's high, low and close."""
    if not candle:
        return None
    _, _, high, low, close = candle
    pivot = (high + low + close) / 3
    return {"s2": rounded(pivot - (high - low)), "s1": rounded(2 * pivot - high), "p": rounded(pivot),
            "r1": rounded(2 * pivot - low), "r2": rounded(pivot + (high - low)), "prevHigh": high, "prevLow": low}


def futures_reading(fut, history, previous):
    if not fut or fut.get("ltp") is None:
        return None
    reading = {"symbol": fut["symbol"], "ltp": fut["ltp"], "oi": fut.get("oi"), "oiChange": None, "oiChangePct": None,
               "buildup": None, "code": None}
    previous_oi = None
    if history and previous and history.futures_symbol == fut["symbol"]:
        previous_oi = history.futures_oi.get(previous[0])
    if previous_oi and fut.get("oi") is not None:
        change = fut["oi"] - previous_oi
        reading["oiChange"] = round(change)
        reading["oiChangePct"] = rounded(change / previous_oi * 100)
        price_change = fut["ltp"] - fut["close"] if fut.get("close") else None
        reading["buildup"] = buildup(price_change, change)
        reading["code"] = BUILDUP_CODES.get(reading["buildup"])
    return reading


def stock_row(member, cash, fut, history, session_date):
    ltp, close = cash["ltp"], cash["close"]
    change_pct = percent(ltp, close)
    vwap, open_, high, low = cash.get("vwap"), cash.get("open"), cash.get("high"), cash.get("low")
    previous = previous_candle(history, session_date)
    futures = futures_reading(fut, history, previous)

    def side(up, down):
        return "bull" if up else "bear" if down else "flat"

    checks = [{"name": "Change", "text": "Price compared with yesterday's close", "side": side(change_pct > 0, change_pct < 0)}]
    if vwap:
        checks.append({"name": "VWAP", "text": "Price compared with today's average price", "side": side(ltp > vwap, ltp < vwap)})
    if open_:
        checks.append({"name": "Open", "text": "Price compared with today's open", "side": side(ltp > open_, ltp < open_)})
    if futures and futures["buildup"]:
        checks.append({"name": "Futures OI", "text": futures["buildup"],
                       "side": side(futures["buildup"] in BULLISH_BUILDUP, futures["buildup"] in BEARISH_BUILDUP)})
    bull = sum(check["side"] == "bull" for check in checks)
    bear = sum(check["side"] == "bear" for check in checks)
    state = "bullish" if bull >= STATE_MIN_CHECKS else "bearish" if bear >= STATE_MIN_CHECKS else "choppy"
    return {
        "symbol": member.symbol, "company": member.company, "sector": member.sector or "Other",
        "ltp": ltp, "prevClose": close, "change": rounded(ltp - close), "changePct": rounded(change_pct),
        "open": open_, "high": high, "low": low, "vwap": rounded(vwap), "vsVwapPct": rounded(percent(ltp, vwap)),
        "rangePos": rounded((ltp - low) / (high - low), 3) if high and low and high > low else None,
        "volume": cash.get("volume"), "futures": futures, "pivots": pivots(previous),
        "checks": checks, "bull": bull, "bear": bear, "score": bull - bear, "state": state,
    }


def mood_for(up, down):
    share = up / (up + down) if up + down else 0.5
    if share >= 0.8:
        return "One-sided rally", "up"
    if share >= 0.6:
        return "More stocks rising", "up"
    if share <= 0.2:
        return "One-sided fall", "down"
    if share <= 0.4:
        return "More stocks falling", "down"
    return "Mixed: stocks are split", "flat"


def breadth(rows):
    up = sum(row["changePct"] > 0 for row in rows)
    down = sum(row["changePct"] < 0 for row in rows)
    moved = up + down
    mood = mood_for(up, down)
    states = defaultdict(int)
    for row in rows:
        states[row.get("state", "choppy")] += 1
    return {"up": up, "down": down, "flat": len(rows) - moved, "bullish": states["bullish"], "bearish": states["bearish"],
            "choppy": states["choppy"], "mood": mood[0], "moodSide": mood[1],
            "avgChangePct": rounded(sum(row["changePct"] for row in rows) / len(rows)) if rows else None}


def sector_flow(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[row["sector"]].append(row)
    sectors = [{"name": name, "avgChangePct": rounded(sum(row["changePct"] for row in members) / len(members)),
                "up": sum(row["changePct"] > 0 for row in members), "down": sum(row["changePct"] < 0 for row in members),
                "stocks": [{"symbol": row["symbol"], "changePct": row["changePct"]}
                           for row in sorted(members, key=lambda row: -row["changePct"])]}
               for name, members in groups.items()]
    return sorted(sectors, key=lambda sector: -sector["avgChangePct"])


def session_date_of(quotes, now):
    dates = [quote["tradeDate"] for quote in quotes if quote and quote.get("tradeDate")]
    return max(set(dates), key=dates.count) if dates else now.date().isoformat()


def index_payload(index_key, now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    members = list(IndexConstituent.objects.filter(index_key=index_key))
    base = {"index": index_key, "label": LABELS[index_key], "marketOpen": market_open(now), "stocks": [], "sectors": []}
    if not members:
        return {**base, "message": "No stocks are set up for this index yet. Add them in admin under Index constituents."}
    client, session = broker()
    if not client:
        return {**base, "message": "Live prices are not connected. Please try again in a few minutes."}
    symbols = [member.symbol for member in members]
    try:
        futures = nearest_futures(symbols)
    except (OSError, KeyError):
        futures = {}
    cash_keys = {member.symbol: KEY_PREFIX + quote_name(member) for member in members}
    fut_keys = {symbol: f"{KEY_PREFIX}NFO:{tradingsymbol}" for symbol, (tradingsymbol, _) in futures.items()}
    spot_key = KEY_PREFIX + SPOT_KEYS[index_key]
    keys = [spot_key, *cash_keys.values(), *fut_keys.values()]

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: compact_quote(quote) for name, quote in raw.items()}

    entries = cached_broker_result(QUOTE_CACHE_ID, session, keys, QUOTE_TTL, fetch)
    retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, QUOTE_TTL)

    def data(key):
        return (entries.get(key) or {}).get("data")

    cash = {symbol: data(key) for symbol, key in cash_keys.items()}
    session_date = session_date_of(cash.values(), now)
    histories = {history.symbol: history for history in StockDailyHistory.objects.filter(symbol__in=symbols)}
    rows = []
    for member in members:
        quote = cash.get(member.symbol)
        if not quote or quote.get("ltp") is None or not quote.get("close"):
            continue
        fut = data(fut_keys[member.symbol]) if member.symbol in fut_keys else None
        if fut:
            fut = {**fut, "symbol": futures[member.symbol][0]}
        rows.append(stock_row(member, quote, fut, histories.get(member.symbol), session_date))
    rows.sort(key=lambda row: -row["changePct"])
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    spot = data(spot_key) or {}
    fetched = [entry["at"] for entry in entries.values() if entry.get("data")]
    sectors = sector_flow(rows)
    message = "" if rows else ("Loading live stock prices..." if retry else "Live stock prices are not available right now.")
    return {
        **base, "stocks": rows, "sectors": sectors, "breadth": breadth(rows),
        "spot": {"ltp": spot.get("ltp"), "change": rounded(spot["ltp"] - spot["close"]) if spot.get("ltp") and spot.get("close") else None,
                 "changePct": rounded(percent(spot.get("ltp"), spot.get("close")))},
        "leading": sectors[0] if len(sectors) > 1 else None, "lagging": sectors[-1] if len(sectors) > 1 else None,
        "sessionDate": session_date, "asOf": int(min(fetched)) if fetched else None,
        "missing": [member.symbol for member in members if member.symbol not in {row["symbol"] for row in rows}],
        "levelsReady": sum(row["pivots"] is not None for row in rows), "retryAfterMs": retry, "message": message,
    }


@never_cache
@require_GET
def index_stocks(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    index_key = request.GET.get("index", "nifty")
    if index_key not in LABELS:
        return JsonResponse({"type": "error", "message": "Select NIFTY 50, BANK NIFTY or SENSEX."}, status=400)
    try:
        return JsonResponse({"type": "success", **index_payload(index_key)})
    except Exception:
        return JsonResponse({"type": "error", "message": "Stock prices are unavailable right now. Please try again shortly."}, status=503)


def heatmap_payload(index_key, now=None):
    """Every stock's change from yesterday and money traded today: the boxes of the heatmap."""
    now = now or dt.datetime.now(MARKET_TZ)
    members = list(IndexConstituent.objects.filter(index_key=index_key))
    base = {"index": index_key, "label": HEATMAP_LABELS[index_key], "marketOpen": market_open(now), "tiles": [], "sectors": []}
    if not members:
        return {**base, "message": "No stocks are set up for this index yet. Add them in admin under Index constituents."}
    client, session = broker()
    if not client:
        return {**base, "message": "Live prices are not connected. Please try again in a few minutes."}
    cash_keys = {member.symbol: KEY_PREFIX + quote_name(member) for member in members}
    spot_key = KEY_PREFIX + HEATMAP_SPOTS[index_key]
    keys = [spot_key, *cash_keys.values()]

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: compact_quote(quote) for name, quote in raw.items()}

    entries = cached_broker_result(QUOTE_CACHE_ID, session, keys, HEATMAP_TTL, fetch)
    retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, HEATMAP_TTL)

    def data(key):
        return (entries.get(key) or {}).get("data")

    tiles = []
    for member in members:
        quote = data(cash_keys[member.symbol])
        if not quote or quote.get("ltp") is None or not quote.get("close"):
            continue
        tiles.append({"symbol": member.symbol, "company": member.company, "sector": member.sector or "Other", "ltp": quote["ltp"],
                      "changePct": rounded(percent(quote["ltp"], quote["close"])),
                      "value": round(quote["ltp"] * (quote.get("volume") or 0))})
    tiles.sort(key=lambda tile: -tile["value"])
    groups = defaultdict(list)
    for tile in tiles:
        groups[tile["sector"]].append(tile)
    sectors = sorted(({"name": name, "count": len(group), "value": sum(tile["value"] for tile in group),
                       "avgChangePct": rounded(sum(tile["changePct"] for tile in group) / len(group)),
                       "up": sum(tile["changePct"] > 0 for tile in group), "down": sum(tile["changePct"] < 0 for tile in group)}
                      for name, group in groups.items()), key=lambda sector: -sector["value"])
    up = sum(tile["changePct"] > 0 for tile in tiles)
    down = sum(tile["changePct"] < 0 for tile in tiles)
    mood, side = mood_for(up, down)
    spot = data(spot_key) or {}
    shown = {tile["symbol"] for tile in tiles}
    fetched = [entry["at"] for entry in entries.values() if entry.get("data")]
    return {
        **base, "tiles": tiles, "sectors": sectors,
        "breadth": {"up": up, "down": down, "flat": len(tiles) - up - down, "mood": mood, "moodSide": side},
        "spot": {"ltp": spot.get("ltp"), "change": rounded(spot["ltp"] - spot["close"]) if spot.get("ltp") and spot.get("close") else None,
                 "changePct": rounded(percent(spot.get("ltp"), spot.get("close")))},
        "asOf": int(min(fetched)) if fetched else None, "missing": [symbol for symbol in cash_keys if symbol not in shown],
        "retryAfterMs": retry,
        "message": "" if tiles else ("Loading live stock prices..." if retry else "Live stock prices are not available right now."),
    }


@never_cache
@require_GET
def index_heatmap(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    index_key = request.GET.get("index", "nifty")
    if index_key not in HEATMAP_LABELS:
        return JsonResponse({"type": "error", "message": "Select NIFTY 50, BANK NIFTY, SENSEX or NIFTY 500."}, status=400)
    try:
        return JsonResponse({"type": "success", **heatmap_payload(index_key)})
    except Exception:
        return JsonResponse({"type": "error", "message": "Stock prices are unavailable right now. Please try again shortly."}, status=503)


def parse_nse_list(text, index_key):
    """(symbol, company, sector, series) rows. NSE's DUMMY... placeholders stand in for corporate actions and never trade."""
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        symbol = (row.get("Symbol") or "").strip()
        if not symbol or symbol.startswith("DUMMY"):
            continue
        rows.append((symbol, row["Company Name"].strip(), sector_for(index_key, symbol, row["Industry"].strip()),
                     (row.get("Series") or "EQ").strip() or "EQ"))
    return rows


def sync_index_constituents(get=requests.get):
    """Refresh NIFTY 50 and NIFTY BANK from NSE. A failed or short download leaves the saved list alone."""
    synced = {}
    for index_key, url in NSE_LISTS.items():
        try:
            response = get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            response.raise_for_status()
            rows = parse_nse_list(response.text, index_key)
        except Exception:
            continue
        if len(rows) < 10:
            continue
        with transaction.atomic():
            IndexConstituent.objects.filter(index_key=index_key).exclude(symbol__in=[row[0] for row in rows]).delete()
            for symbol, company, sector, series in rows:
                IndexConstituent.objects.update_or_create(index_key=index_key, symbol=symbol,
                                                          defaults={"company": company, "sector": sector, "series": series})
        synced[index_key] = len(rows)
    return synced


def refresh_stock_history(client=None, now=None, max_calls=HISTORY_CALLS_PER_RUN, pause=HISTORY_PAUSE):
    """Save the last ~two weeks of daily candles (and futures OI) for every index stock, once a day."""
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    if client is None:
        client, _ = broker()
        if not client:
            return 0
    # Daily history is only for the detailed screens; the NIFTY 500 heatmap needs live prices alone.
    members = {member.symbol: member for member in IndexConstituent.objects.filter(index_key__in=LABELS)}
    symbols = sorted(members)
    fresh = set(StockDailyHistory.objects.filter(symbol__in=symbols, updated_on=today).values_list("symbol", flat=True))
    stale = [symbol for symbol in symbols if symbol not in fresh]
    if not stale:
        return 0
    try:
        futures = nearest_futures(stale)
    except (OSError, KeyError):
        futures = {}
    names = {quote_name(members[symbol]): symbol for symbol in stale}
    tokens = {names[name]: quote.get("instrument_token") for name, quote in client.ltp(list(names)).items() if name in names}
    start = dt.datetime.combine(today - dt.timedelta(days=HISTORY_DAYS), dt.time.min)
    end = dt.datetime.combine(today, dt.time.min) - dt.timedelta(minutes=1)  # complete sessions only
    calls, saved = 1, 0
    for symbol in stale:
        future = futures.get(symbol)
        needed = 2 if future else 1
        if calls + needed > max_calls:
            break
        token = tokens.get(symbol)
        if not token:
            continue
        try:
            candles = client.historical_data(token, start, end, "day")
            calls += 1
            time.sleep(pause)
            oi = {}
            if future:
                rows = client.historical_data(future[1], start, end, "day", oi=True)
                calls += 1
                time.sleep(pause)
                oi = {row["date"].date().isoformat(): row["oi"] for row in rows if row.get("oi")}
        except Exception:
            continue
        StockDailyHistory.objects.update_or_create(symbol=symbol, defaults={
            "candles": [[row["date"].date().isoformat(), row["open"], row["high"], row["low"], row["close"]] for row in candles],
            "futures_symbol": future[0] if future else "", "futures_oi": oi, "updated_on": today})
        saved += 1
    return saved

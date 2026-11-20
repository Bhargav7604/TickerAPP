"""The Commodity view of Home: the same cards, traffic lights, history and overview as the Indian market, for MCX.

Each card follows the index cards' rules. Direction compares the futures price with 30 minutes ago and with VWAP.
Big players reads the futures themselves, because there are no MCX option chains here: open interest built up since
the last session (long or short build-up), confirmed or contradicted by the lots waiting in the order book.
"""
import datetime as dt
from zoneinfo import ZoneInfo

import pandas as pd
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .board_universe import previous_candle, previous_oi
from .commodities import CONTINUOUS_PREFIX, KEY_PREFIX, STATS_PREFIX, compact, mcx_session
from . import commodity_math as cm
from .decision import DISCLAIMER, LATE_AFTER, direction, light, trap
from .equity import QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result
from .index_stocks import quote_batches
from .live_dashboard import instrument
from .logger import log
from .market_contracts import COMMODITY_NAMES, CONTRACT_MONTH_INDEX, MARKET_TZ, get_master_contract, resolve_contract_rows
from .models import MarketSnapshot, UniverseStats
from .snapshot_recorder import current_bucket_time, save_snapshot
from .views import protected

LABELS = {"crudeoil": "CRUDE OIL", "naturalgas": "NATURAL GAS", "gold": "GOLD", "silver": "SILVER", "copper": "COPPER", "zinc": "ZINC"}
OPENING_END = dt.time(9, 15)
QUOTE_TTL = 2
BUILD_TEXT = {"LB": "fresh buying (long build-up)", "SB": "fresh selling (short build-up)",
              "SC": "sellers closing positions (short covering)", "LU": "buyers closing positions (long unwinding)"}


def contract_rows(master_contract=None):
    """{(month, key): master-contract row} for current, next and far MCX futures of each commodity."""
    return resolve_contract_rows(master_contract, COMMODITY_NAMES, "MCX")


def live_quotes(rows, extra_names=()):
    """{tradingsymbol: compact quote with "fetchedAt"}, the cache's retry hint, or ({}, None) without a broker.

    extra_names ("CDS:USDINR26NOVFUT") ride in the same cached fetch: the cache allows one broker call per request.
    """
    client, session = broker()
    if not client:
        return {}, None, False
    keys = sorted({KEY_PREFIX + "MCX:" + row["tradingsymbol"] for row in rows.values()} | {KEY_PREFIX + name for name in extra_names})

    def fetch(missing):
        raw = quote_batches(client, [key[len(KEY_PREFIX):] for key in missing])
        return {KEY_PREFIX + name: compact(quote) for name, quote in raw.items()}

    entries = cached_broker_result(QUOTE_CACHE_ID, session, keys, QUOTE_TTL, fetch)
    quotes = {key[len(KEY_PREFIX) + 4:]: {**entry["data"], "fetchedAt": entry["at"]} for key, entry in entries.items() if entry.get("data")}
    return quotes, cache_retry_ms(QUOTE_CACHE_ID, entries, keys, QUOTE_TTL), True


def build_up(change, oi_change):
    if change is None or oi_change is None:
        return None
    if change >= 0:
        return "LB" if oi_change >= 0 else "SC"
    return "SB" if oi_change >= 0 else "LU"


def futures_players(build, oi_change_pct, net_lots):
    """Fresh positions in the futures (open interest) checked against the order book; same labels as the index cards."""
    details, positions, book = [], 0, 0
    if build:
        positions = {"LB": 1, "SB": -1}.get(build, 0)
        details.append(f"Futures open interest {'rose' if oi_change_pct >= 0 else 'fell'} {abs(oi_change_pct):.1f}% since the last session "
                       f"while the price {'rose' if build in ('LB', 'SC') else 'fell'}: {BUILD_TEXT[build]}.")
    if net_lots:
        book = 1 if net_lots > 0 else -1
        details.append(f"In futures, {abs(net_lots):,.0f} more lots are waiting to {'buy' if net_lots > 0 else 'sell'}.")
    sign = 0 if positions and book and positions != book else (positions or book)
    code = {1: "buying", -1: "selling", 0: "mixed"}[sign]
    label = {"buying": "Big players are buying", "selling": "Big players are selling", "mixed": "Big players are not clearly on one side"}[code]
    return {"code": code, "label": label, "detail": " ".join(details) or "No position data yet today."}


def session_points(key, symbol):
    """[(time, price, vwap)] for the latest recorded session of this contract, oldest first."""
    latest = MarketSnapshot.objects.filter(index_key=key, contract_month="current", symbol=symbol).order_by("-bucket_time").first()
    if not latest:
        return [], None
    day = dt.datetime.combine(latest.bucket_time.date(), dt.time.min)
    rows = MarketSnapshot.objects.filter(index_key=key, contract_month="current", symbol=symbol, bucket_time__gte=day).order_by("bucket_time")
    return [(row.bucket_time.replace(tzinfo=None), row.index_level, row.vwap) for row in rows if row.index_level], latest


def history_before(stat, session_day):
    """Complete daily candles before the session on screen (today's unfinished candle left out)."""
    return [row for row in (stat.recent if stat else []) if row[0] < session_day.isoformat()]


def card(key, now, row, quote, stat, session, continuous=None):
    symbol = row["tradingsymbol"]
    points, latest = session_points(key, symbol)
    price, change, as_of, vwap = (points[-1][1] if points else None), None, (latest.bucket_time.replace(tzinfo=None) if latest else None), None
    net_lots = latest.net_lots if latest else None
    if points:
        change = {"value": round(points[-1][1] - points[0][1], 2), "pct": round((points[-1][1] / points[0][1] - 1) * 100, 2), "since": "open"}
    if quote.get("ltp"):
        price, vwap = quote["ltp"], quote.get("vwap")
        as_of = dt.datetime.fromtimestamp(quote["fetchedAt"], MARKET_TZ).replace(tzinfo=None)
        if quote.get("close"):
            change = {"value": round(price - quote["close"], 2), "pct": round((price / quote["close"] - 1) * 100, 2), "since": "yesterday"}
        if quote.get("buyQty") is not None and quote.get("sellQty") is not None:
            net_lots = quote["buyQty"] - quote["sellQty"]  # MCX quantities are already in lots
        points = points + [(as_of, price, vwap if vwap is not None else (points[-1][2] if points else None))]
    traded_day = dt.datetime.fromtimestamp(quote["tradedAt"], MARKET_TZ).date() if quote.get("tradedAt") else now.date()
    prev_oi = previous_oi(stat.fut_oi, traded_day) if stat else None
    oi_change_pct = (quote["oi"] - prev_oi) / prev_oi * 100 if quote.get("oi") is not None and prev_oi else None
    build = build_up(change["value"] if change and change["since"] == "yesterday" else None, oi_change_pct)
    is_open = session["open"]
    late = bool(is_open and (as_of is None or now.replace(tzinfo=None) - as_of > LATE_AFTER))
    move = direction(points)
    players = futures_players(build, oi_change_pct, net_lots)
    warning = trap(move["code"], players["code"])
    expiry = row["expiry"].date()
    expiry_today = expiry == now.date()
    candles = history_before(continuous, traded_day)
    expected = cm.expected_range(LABELS[key], quote.get("close") or (candles[-1][4] if candles else None),
                                 cm.daily_volatility(candles), price, cm.pivots(previous_candle(candles, traded_day)))
    return {
        "key": key, "label": LABELS[key], "symbol": symbol, "price": price, "change": change,
        "asOf": int(as_of.replace(tzinfo=MARKET_TZ).timestamp()) if as_of else None, "late": late, "live": bool(quote.get("ltp")),
        "direction": move, "bigPlayers": players, "trap": warning,
        "light": light(now, is_open, late, expiry_today, warning, move["code"], players["code"], [], opening_end=OPENING_END),
        "range": expected, "expiryLevel": None, "expiry": {"date": expiry.isoformat(), "isToday": expiry_today},
        "numbers": {"netLots": net_lots, "oiChangePct": round(oi_change_pct, 2) if oi_change_pct is not None else None,
                    "buildup": build, "pcr": None},
    }


def calendar(frame, today):
    """Next three futures expiries of each commodity, in the index calendar's shape."""
    out = {}
    for key, name in COMMODITY_NAMES.items():
        rows = frame[frame["exchange"].eq("MCX") & frame["name"].eq(name) & frame["instrument_type"].eq("FUT")
                     & (frame["expiry"] >= pd.Timestamp(today))]
        out[key] = [{"date": date.isoformat(),
                     "label": "Today" if date == today else "Tomorrow" if date == today + dt.timedelta(days=1) else f"{date:%a %d %b}",
                     "thisWeek": date.isocalendar()[:2] == today.isocalendar()[:2]}
                    for date in sorted(rows["expiry"].dt.date.unique())[:3]]
    return out


def us_open_ist(now):
    """US cash markets open at 09:30 New York time; in IST that is 19:00 in the US summer and 20:00 in the winter."""
    new_york = now.astimezone(ZoneInfo("America/New_York"))
    return "19:00" if new_york.dst() else "20:00"


def must_know(now, cards, schedule, session):
    items = []
    if not session["open"]:
        items.append({"level": "info", "text": f"MCX is closed. Cards show the last trading session. It opens at {session['opensAt']}."})
    late = [card for card in cards if card["late"]]
    if late:
        last = max((card["asOf"] for card in late if card["asOf"]), default=None)
        when = dt.datetime.fromtimestamp(last, MARKET_TZ).strftime("%d %b, %H:%M") if last else "unknown"
        items.append({"level": "danger", "text": f"Our data is late (last update {when} IST). Numbers may be old, so please don't rely on them."})
    if session["open"] and now.time() < OPENING_END:
        items.append({"level": "warning", "text": "First 15 minutes of MCX: prices jump around. Many traders wait."})
    for key, expiries in schedule.items():
        if expiries and expiries[0]["label"] == "Today":
            items.append({"level": "danger", "text": f"{LABELS[key]} futures expire today. Close or roll positions in time."})
        elif expiries and expiries[0]["label"] == "Tomorrow":
            items.append({"level": "warning", "text": f"{LABELS[key]} futures expire tomorrow."})
    if session["open"]:
        items.append({"level": "info", "text": f"US markets open at {us_open_ist(now)} IST; crude oil, gold and silver often move sharply then. "
                                               f"MCX closes at {session['closesAt']}."})
    order = {"danger": 0, "warning": 1, "info": 2}
    return sorted(items, key=lambda item: order.get(item["level"], 3))


def commodity_home_payload(now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    frame = get_master_contract()
    rows = contract_rows(frame)
    session = mcx_session(now)
    current = {key: rows[("current", key)] for key in COMMODITY_NAMES if ("current", key) in rows}
    quotes, retry, connected = live_quotes(current)
    stats = {row.symbol: row for row in UniverseStats.objects.filter(symbol__in=[STATS_PREFIX + row["tradingsymbol"] for row in current.values()]
                                                                       + [CONTINUOUS_PREFIX + name for name in COMMODITY_NAMES.values()])}
    cards = [card(key, now, row, quotes.get(row["tradingsymbol"], {}), stats.get(STATS_PREFIX + row["tradingsymbol"]), session,
                  stats.get(CONTINUOUS_PREFIX + COMMODITY_NAMES[key])) for key, row in current.items()]
    schedule = calendar(frame, today)
    expiring = [key for key, expiries in schedule.items() if expiries and expiries[0]["label"] == "Today"]
    close = dt.datetime.combine(today, dt.time.fromisoformat(session["closesAt"]), tzinfo=MARKET_TZ)
    return {
        "market": "commodity", "cards": cards, "mustKnow": must_know(now, cards, schedule, session), "calendar": schedule,
        "expiryToday": expiring, "marketOpen": session["open"], "lastHour": False, "closesAt": int(close.timestamp()),
        "now": int(now.timestamp()), "disclaimer": DISCLAIMER.replace("F&O trading", "Commodity futures trading"),
        "optionCost": None, "session": session, "retryAfterMs": retry,
        "message": "" if connected else "Live prices are not connected. Cards show the last recorded snapshots.",
    }


def overview_payload(now=None):
    """Current, next and far futures of each commodity with the order book's net lots, for the market overview."""
    now = now or dt.datetime.now(MARKET_TZ)
    rows = contract_rows()
    quotes, retry, connected = live_quotes(rows)
    commodities = []
    for key in COMMODITY_NAMES:
        months = []
        for month in CONTRACT_MONTH_INDEX:
            row = rows.get((month, key))
            if row is None:
                continue
            quote = quotes.get(row["tradingsymbol"], {})
            ltp, close = quote.get("ltp"), quote.get("close")
            buy, sell = quote.get("buyQty"), quote.get("sellQty")
            months.append({
                "month": month, "symbol": row["tradingsymbol"], "expiry": row["expiry"].date().isoformat(), "ltp": ltp,
                "change": round(ltp - close, 2) if ltp is not None and close else None,
                "changePct": round((ltp / close - 1) * 100, 2) if ltp is not None and close else None,
                "netLots": buy - sell if buy is not None and sell is not None else None,
                "demandSupply": round(buy / sell, 2) if buy is not None and sell else None,
                "buyQty": buy, "sellQty": sell, "vwap": quote.get("vwap"), "oi": quote.get("oi"), "volume": quote.get("volume"),
                "open": quote.get("open"), "high": quote.get("high"), "low": quote.get("low"), "prevClose": close,
                "bid": quote.get("bid"), "ask": quote.get("ask"), "tradedAt": quote.get("tradedAt"),
            })
        commodities.append({"key": key, "label": LABELS[key], "months": months})
    fetched = [quote["fetchedAt"] for quote in quotes.values()]
    return {"commodities": commodities, "session": mcx_session(now), "asOf": int(min(fetched)) if fetched else None,
            "retryAfterMs": retry, "message": "" if connected else "Live prices are not connected. Please try again in a few minutes."}


def history_payload(key, month):
    """The latest recorded session of one contract: price, VWAP and net lots every five minutes."""
    row = contract_rows().get((month, key))
    if row is None:
        return {"key": key, "month": month, "points": [], "message": "This contract is not in today's list."}
    symbol = row["tradingsymbol"]
    latest = MarketSnapshot.objects.filter(index_key=key, contract_month=month, symbol=symbol).order_by("-bucket_time").first()
    points = []
    if latest:
        day = dt.datetime.combine(latest.bucket_time.date(), dt.time.min)
        points = [{"time": int(snapshot.bucket_time.replace(tzinfo=MARKET_TZ).timestamp()), "price": snapshot.index_level,
                   "vwap": snapshot.vwap, "netLots": snapshot.net_lots, "demandSupply": snapshot.demand_supply_ratio,
                   "volume": snapshot.interval_volume}
                  for snapshot in MarketSnapshot.objects.filter(index_key=key, contract_month=month, symbol=symbol, bucket_time__gte=day).order_by("bucket_time")]
    return {"key": key, "label": LABELS[key], "month": month, "symbol": symbol, "points": points,
            "message": "" if points else "Net lots appear after the first five minutes of MCX trading are recorded."}


def record_commodity_snapshot(client=None, now=None):
    """Every five minutes while MCX is open: price, VWAP and net lots of each commodity's three futures."""
    now = now or dt.datetime.now(MARKET_TZ)
    if not mcx_session(now)["open"]:
        return 0
    if client is None:
        client, _ = broker()
        if not client:
            return 0
    rows = contract_rows()
    names = {f"MCX:{row['tradingsymbol']}": key for key, row in rows.items()}
    try:
        quotes = client.quote(list(names))
    except Exception as exc:
        log(f"Commodity snapshot skipped ({type(exc).__name__}).", "ERROR")
        return 0
    bucket = current_bucket_time(now.astimezone(MARKET_TZ)).replace(tzinfo=None)
    saved = 0
    for name, (month, key) in names.items():
        quote = quotes.get(name)
        if quote and save_snapshot(month, key, rows[(month, key)], quote, bucket):
            saved += 1
    return saved


def insights_payload(now=None):
    """Trend, volatility, expected range, term structure, rollover and money per lot for each commodity, plus cross reads."""
    now = now or dt.datetime.now(MARKET_TZ)
    rows = contract_rows()
    rupee_name = instrument("usd-inr")  # USD/INR near-month futures, the contract the Dashboard charts
    quotes, retry, connected = live_quotes(rows, [rupee_name] if rupee_name else [])
    names = list(COMMODITY_NAMES.values())
    current_symbols = [rows[("current", key)]["tradingsymbol"] for key in COMMODITY_NAMES if ("current", key) in rows]
    stats = {row.symbol: row for row in UniverseStats.objects.filter(
        symbol__in=[CONTINUOUS_PREFIX + name for name in names] + [STATS_PREFIX + symbol for symbol in current_symbols])}
    items, today_pct, history = [], {}, {}
    for key, name in COMMODITY_NAMES.items():
        current, upcoming, far = (rows.get((month, key)) for month in ("current", "next", "far"))
        if current is None:
            continue
        quote_of = lambda contract: quotes.get(contract["tradingsymbol"], {}) if contract is not None else {}
        q_now, q_next, q_far = quote_of(current), quote_of(upcoming), quote_of(far)
        ltp, close = q_now.get("ltp"), q_now.get("close")
        session_day = dt.datetime.fromtimestamp(q_now["tradedAt"], MARKET_TZ).date() if q_now.get("tradedAt") else now.date()
        candles = history_before(stats.get(CONTINUOUS_PREFIX + name), session_day)
        history[name] = candles
        change = ltp - close if cm.finite(ltp) and cm.finite(close) else None
        today_pct[name] = change / close * 100 if change is not None and close else None
        days = lambda contract: (contract["expiry"].date() - now.date()).days if contract is not None else None
        stat = stats.get(STATS_PREFIX + current["tradingsymbol"])
        prev_oi = previous_oi(stat.fut_oi, session_day) if stat else None
        oi_change = (q_now["oi"] - prev_oi) / prev_oi * 100 if cm.finite(q_now.get("oi")) and prev_oi else None
        volatility, sigma = cm.volatility(candles, q_now.get("high"), q_now.get("low"), ltp)
        levels = cm.pivots(previous_candle(candles, session_day))
        items.append({
            "key": key, "name": name, "label": LABELS[key], "symbol": current["tradingsymbol"], "ltp": ltp, "prevClose": close,
            "change": cm.rounded(change), "changePct": cm.rounded(today_pct[name]), "sessions": len(candles),
            "trend": cm.trend(candles, ltp), "volatility": volatility,
            "range": cm.expected_range(LABELS[key], close or (candles[-1][4] if candles else None), sigma, ltp, levels),
            "levels": {name_: cm.rounded(value) for name_, value in levels.items()} if levels else None,
            "term": {**cm.term_structure(ltp, q_next.get("ltp"), q_far.get("ltp"), days(current), days(upcoming)),
                     **cm.rollover(q_now.get("oi"), q_next.get("oi"), q_far.get("oi"), days(current)),
                     "daysToExpiry": days(current), "nextSymbol": upcoming["tradingsymbol"] if upcoming is not None else None},
            "positions": {"oiChangePct": cm.rounded(oi_change), "buildup": build_up(change, oi_change)},
            "lot": cm.per_lot(name, ltp, change, volatility["atr"]),
        })
    by_name = {item["name"]: item for item in items}
    gold, silver = by_name.get("GOLD", {}), by_name.get("SILVER", {})
    rupee = quotes.get(rupee_name.split(":", 1)[1], {}) if rupee_name else {}
    rupee_pct = (rupee["ltp"] / rupee["close"] - 1) * 100 if rupee.get("ltp") and rupee.get("close") else None
    cross = {
        "goldSilver": cm.gold_silver_ratio(gold.get("ltp"), silver.get("ltp"), history.get("GOLD", []), history.get("SILVER", [])),
        "copperGold": cm.relative_strength(today_pct.get("COPPER"), today_pct.get("GOLD"), "Copper", "gold",
                                           "industry demand and risk appetite are leading.", "money is hiding in the safe haven."),
        "crudeGas": cm.relative_strength(today_pct.get("CRUDEOIL"), today_pct.get("NATURALGAS"), "Crude oil", "natural gas",
                                         "oil-specific news is driving energy.", "gas-specific news (weather, storage) is driving energy."),
        "rupee": cm.rupee_effect(rupee.get("ltp"), rupee_pct),
    }
    return {"items": items, "cross": cross, "session": mcx_session(now), "retryAfterMs": retry,
            "message": "" if connected else "Live prices are not connected. Please try again in a few minutes."}


@gzip_page
@never_cache
@require_GET
def commodity_insights(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    return _guarded(insights_payload)


def _guarded(build):
    try:
        return JsonResponse({"type": "success", **build()})
    except Exception:
        return JsonResponse({"type": "error", "message": "Commodity data is unavailable right now. Please try again shortly."}, status=503)


@gzip_page
@never_cache
@require_GET
def commodity_home(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    return _guarded(commodity_home_payload)


@gzip_page
@never_cache
@require_GET
def commodity_overview(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    return _guarded(overview_payload)


@never_cache
@require_GET
def commodity_history(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    key, month = request.GET.get("key", ""), request.GET.get("month", "current")
    if key not in COMMODITY_NAMES or month not in CONTRACT_MONTH_INDEX:
        return JsonResponse({"type": "error", "message": "Choose a commodity and current, next or far month."}, status=400)
    return _guarded(lambda: history_payload(key, month))

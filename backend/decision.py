"""Plain-language home cards: market direction, big players, trap warning, Trade/Wait light and expected range.

Every rule is deliberately simple and spelled out here so it can be reviewed and back-tested.
Utraders describes the market; nothing here tells anyone to buy or sell.
"""
import datetime as dt
import math
import time

import requests
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .equity import broker, catalogue
from .market_contracts import CONTRACT_NAMES, MARKET_TZ, resolve_contracts
from .models import LiveMarketFeed, MarketNote, MarketSnapshot
from .oi_analysis import chain_payload, trend_payload, years_to_expiry
from .risk import expiry_close_level, option_cost
from .views import protected

LABELS = {"nifty": "NIFTY", "banknifty": "BANKNIFTY", "sensex": "SENSEX"}
STRIKE_STEPS = {"nifty": 50, "banknifty": 100, "sensex": 100}
MARKET_OPEN, MARKET_CLOSE = dt.time(9, 15), dt.time(15, 30)
OPENING_CAUTION_END = dt.time(9, 30)
EXPIRY_LAST_HOUR = dt.time(14, 30)
LATE_AFTER = dt.timedelta(minutes=10)
DIRECTION_WINDOW = dt.timedelta(minutes=30)
DIRECTION_MIN_MOVE_PCT = 0.15
OI_STRENGTH_MIN = 20
BAN_LIST_URL = "https://nsearchives.nseindia.com/content/fo/fo_secban.csv"
BAN_LIST_RETRY = 15 * 60
DISCLAIMER = ("Utraders describes the market. It does not tell you to buy or sell. F&O trading is high risk and most "
              "traders lose money. Please talk to a SEBI-registered adviser before you invest.")
_ban_cache = {}


def compact(value):
    size = abs(value)
    if size >= 1e7:
        return f"{value / 1e7:.2f} Cr"
    if size >= 1e5:
        return f"{value / 1e5:.2f} L"
    return f"{value:,.0f}"


def market_open(now):
    return now.weekday() < 5 and MARKET_OPEN <= now.time() <= MARKET_CLOSE


def direction(points):
    """points: [(time, futures price, vwap)] oldest first. Compares now with ~30 minutes ago and with VWAP."""
    if len(points) < 2:
        return {"code": "flat", "label": "Going nowhere", "detail": "Not enough data yet today.", "move": 0}
    last_time, last, vwap = points[-1]
    base_time, base = next(((t, p) for t, p, _ in reversed(points) if last_time - t >= DIRECTION_WINDOW), points[0][:2])
    move = (last - base) / base * 100
    minutes = int((last_time - base_time).total_seconds() // 60)
    side = "" if vwap is None else f" and {'above' if last >= vwap else 'below'} today's average price (VWAP {vwap:,.1f})"
    detail = f"Futures {'up' if move >= 0 else 'down'} {abs(move):.2f}% in the last {minutes} minutes{side}."
    if move >= DIRECTION_MIN_MOVE_PCT and (vwap is None or last >= vwap):
        return {"code": "up", "label": "Going up", "detail": detail, "move": round(move, 2)}
    if move <= -DIRECTION_MIN_MOVE_PCT and (vwap is None or last <= vwap):
        return {"code": "down", "label": "Going down", "detail": detail, "move": round(move, 2)}
    return {"code": "flat", "label": "Going nowhere", "detail": detail, "move": round(move, 2)}


def big_players(oi_row, net_lots):
    """Option writers' put-vs-call OI build-up near ATM, confirmed (or contradicted) by the futures order book."""
    details, options, futures = [], 0, 0
    if oi_row:
        strength = oi_row["strength"]
        options = 1 if strength >= OI_STRENGTH_MIN else -1 if strength <= -OI_STRENGTH_MIN else 0
        details.append(f"Option sellers added {compact(oi_row['putOiChange'])} put OI and {compact(oi_row['callOiChange'])} "
                       f"call OI near today's price ({'more put selling, which usually means they expect the market to hold or rise' if strength > 0 else 'more call selling, which usually means they expect the market to stay down'}).")
    if net_lots:
        futures = 1 if net_lots > 0 else -1
        details.append(f"In futures, {abs(net_lots):,.0f} more lots are waiting to {'buy' if net_lots > 0 else 'sell'}.")
    if options and futures and options != futures:
        sign = 0
    else:
        sign = options or futures
    code = {1: "buying", -1: "selling", 0: "mixed"}[sign]
    label = {"buying": "Big players are buying", "selling": "Big players are selling", "mixed": "Big players are not clearly on one side"}[code]
    return {"code": code, "label": label, "detail": " ".join(details) or "No position data yet today."}


def trap(direction_code, players_code):
    if direction_code == "up" and players_code == "selling":
        return {"message": "Careful. This rise may not last. Don't chase it.",
                "detail": "Price is rising, but big players are building positions that gain if it falls."}
    if direction_code == "down" and players_code == "buying":
        return {"message": "Careful. This fall may not last. Don't chase it.",
                "detail": "Price is falling, but big players are building positions that gain if it rises."}
    return None


def light(now, is_open, late, expiry_today, trap_warning, direction_code, players_code, danger_notes):
    if not is_open:
        return {"color": "grey", "label": "Market closed", "reasons": ["Showing the last trading session."]}
    red = []
    if late:
        red.append("Our data is late, so these numbers may be old.")
    if now.time() < OPENING_CAUTION_END:
        red.append("First 15 minutes of the day: prices jump around.")
    if expiry_today and now.time() >= EXPIRY_LAST_HOUR:
        red.append("Last hour of expiry: option prices can jump fast.")
    if trap_warning:
        red.append("Price and big players disagree (possible trap).")
    red.extend(f"Big news today: {note}" for note in danger_notes)
    if red:
        return {"color": "red", "label": "Risky time. Better to wait.", "reasons": red}
    yellow = []
    if direction_code == "flat":
        yellow.append("The market is going nowhere.")
    if players_code == "mixed":
        yellow.append("Big players are not clearly on one side.")
    elif direction_code != "flat" and {"up": "buying", "down": "selling"}[direction_code] != players_code:
        yellow.append("Price and big players point different ways.")
    if yellow:
        return {"color": "yellow", "label": "Unclear. Trade small.", "reasons": yellow}
    return {"color": "green", "label": "Good time to trade.", "reasons": ["Price direction and big players agree."]}


def expected_range(key, chain, expiry, now):
    if not chain or not chain.get("rows") or not chain.get("underlying"):
        return None
    spot, atm = chain["underlying"], chain.get("atm")
    row = next((row for row in chain["rows"] if row["strike"] == atm), None)
    ivs = [side["iv"] for side in (row.get("call"), row.get("put")) if row and side and side.get("iv")] if row else []
    years = years_to_expiry(expiry, now.replace(tzinfo=None))
    if not ivs or years <= 0:
        return None
    iv = sum(ivs) / len(ivs)
    move = spot * iv / 100 * math.sqrt(years)
    step = STRIKE_STEPS[key]
    low, high = math.floor((spot - move) / step) * step, math.ceil((spot + move) / step) * step
    when = "today's close" if expiry == now.date() else f"expiry on {expiry:%d %b}"
    below = [row for row in chain["rows"] if row["strike"] <= spot and row.get("put")]
    above = [row for row in chain["rows"] if row["strike"] >= spot and row.get("call")]
    support = max(below, key=lambda row: row["put"]["oi"])["strike"] if below else None
    resistance = max(above, key=lambda row: row["call"]["oi"])["strike"] if above else None
    return {"low": low, "high": high, "spot": spot, "iv": round(iv, 1), "expiry": expiry.isoformat(),
            "support": support, "resistance": resistance,
            "text": f"{LABELS[key]} will most likely stay between {low:,.0f} and {high:,.0f} until {when} (about a 2 in 3 chance)."}


def ban_list(today):
    cached = _ban_cache.get(today)
    if cached and (cached["names"] is not None or time.time() - cached["at"] < BAN_LIST_RETRY):
        return cached["names"]
    names = None
    try:
        response = requests.get(BAN_LIST_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
        response.raise_for_status()
        lines = response.text.strip().splitlines()
        names = [line.split(",", 1)[1].strip() for line in lines[1:] if "," in line]
    except Exception:
        names = None
    _ban_cache.clear()
    _ban_cache[today] = {"names": names, "at": time.time()}
    return names


def expiry_calendar(today):
    frame = catalogue(index_options=True)
    calendar = {}
    for key, name in CONTRACT_NAMES.items():
        expiries = sorted(date for date in frame[frame["name"].eq(name)]["expiry"].dt.date.unique() if date >= today)[:3]
        calendar[key] = [{
            "date": date.isoformat(),
            "label": "Today" if date == today else "Tomorrow" if date == today + dt.timedelta(days=1) else f"{date:%a %d %b}",
            "thisWeek": date.isocalendar()[:2] == today.isocalendar()[:2],
        } for date in expiries]
    return calendar


def live_quotes():
    state = LiveMarketFeed.objects.filter(pk=1).first()
    if not state or state.payload.get("status") != "live" or (timezone.now() - state.updated_at).total_seconds() > 15:
        return None
    return state.payload


def card(key, now, contracts, calendar, danger_notes, feed):
    symbol = (contracts.get(key) or {}).get("symbol")
    latest = MarketSnapshot.objects.filter(index_key=key, symbol=symbol).order_by("-bucket_time").first() if symbol else None
    points, net_lots, as_of = [], None, None
    if latest:
        day = dt.datetime.combine(latest.bucket_time.date(), dt.time.min)
        rows = MarketSnapshot.objects.filter(index_key=key, symbol=symbol, bucket_time__gte=day).order_by("bucket_time")
        points = [(row.bucket_time.replace(tzinfo=None), row.index_level, row.vwap) for row in rows if row.index_level]
        net_lots, as_of = latest.net_lots, latest.bucket_time.replace(tzinfo=None)
    price, change = (points[-1][1] if points else None), None
    if points:
        change = {"value": round(points[-1][1] - points[0][1], 2), "pct": round((points[-1][1] / points[0][1] - 1) * 100, 2), "since": "open"}
    if feed:
        token = ((feed.get("contracts") or {}).get("current", {}).get(key) or {}).get("token")
        tick = (feed.get("ticks") or {}).get(str(token)) or {}
        if tick.get("last_price"):
            price, as_of = tick["last_price"], now.replace(tzinfo=None)
            close = (tick.get("ohlc") or {}).get("close")
            if close:
                change = {"value": round(price - close, 2), "pct": round((price / close - 1) * 100, 2), "since": "yesterday"}
            if points:
                points.append((as_of, price, points[-1][2]))
    expiries = calendar.get(key) or []
    expiry = dt.date.fromisoformat(expiries[0]["date"]) if expiries else None
    oi_row, chain, oi_expiry = None, None, None
    if expiry:
        trend = trend_payload(key, expiry, 3, 7)
        oi_row = trend["rows"][0] if trend.get("rows") else None
        chain = chain_payload(key, expiry)
        oi_expiry = expiry
    is_open = market_open(now)
    late = bool(is_open and (as_of is None or now.replace(tzinfo=None) - as_of > LATE_AFTER))
    move = direction(points)
    players = big_players(oi_row, net_lots)
    warning = trap(move["code"], players["code"])
    expiry_today = expiry == now.date()
    return {
        "key": key, "label": LABELS[key], "symbol": symbol, "price": price, "change": change,
        "asOf": int(as_of.replace(tzinfo=MARKET_TZ).timestamp()) if as_of else None, "late": late, "live": bool(feed),
        "direction": move, "bigPlayers": players, "trap": warning,
        "light": light(now, is_open, late, expiry_today, warning, move["code"], players["code"], danger_notes),
        "range": expected_range(key, chain, oi_expiry, now) if oi_expiry else None,
        "expiryLevel": expiry_close_level(chain.get("rows", []), chain.get("underlying")) if chain else None,
        "expiry": {"date": expiry.isoformat(), "isToday": expiry_today} if expiry else None,
        "numbers": {"netLots": net_lots, "oi": oi_row and {k: oi_row[k] for k in ("callOiChange", "putOiChange", "diff", "strength", "changePcr")},
                    "pcr": chain and chain.get("totals", {}).get("pcr")},
    }


def must_know(now, cards, calendar, notes, banned):
    items = []
    is_open = market_open(now)
    if not is_open:
        items.append({"level": "info", "text": "The market is closed. Cards show the last trading session."})
    late = [card for card in cards if card["late"]]
    if late:
        last = max((card["asOf"] for card in late if card["asOf"]), default=None)
        when = dt.datetime.fromtimestamp(last, MARKET_TZ).strftime("%d %b, %H:%M") if last else "unknown"
        items.append({"level": "danger", "text": f"Our data is late (last update {when} IST). Numbers may be old, so please don't rely on them."})
    if is_open and now.time() < OPENING_CAUTION_END:
        items.append({"level": "warning", "text": "First 15 minutes of the day: prices jump around. Many traders wait."})
    for key, expiries in calendar.items():
        if expiries and expiries[0]["label"] == "Today":
            items.append({"level": "danger", "text": f"{LABELS[key]} options expire today. After 2:30 pm prices can jump very fast."})
        elif expiries and expiries[0]["label"] == "Tomorrow":
            items.append({"level": "warning", "text": f"{LABELS[key]} options expire tomorrow."})
    if banned:
        items.append({"level": "warning", "text": f"In F&O ban today (no new positions allowed): {', '.join(banned)}."})
    elif banned is None:
        items.append({"level": "info", "text": "Could not load today's F&O ban list from NSE."})
    items.extend({"level": note.level, "text": note.message} for note in notes)
    order = {"danger": 0, "warning": 1, "info": 2}
    return sorted(items, key=lambda item: order.get(item["level"], 3))


def india_vix():
    client, _ = broker()
    if not client:
        return None
    try:
        return client.quote("NSE:INDIA VIX")["NSE:INDIA VIX"]["last_price"]
    except Exception:
        return None


def decision_payload(now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    notes = list(MarketNote.objects.filter(date=today))
    danger_notes = [note.message for note in notes if note.level == "danger"]
    calendar = expiry_calendar(today)
    contracts = resolve_contracts("current")
    feed = live_quotes()
    cards = [card(key, now, contracts, calendar, danger_notes, feed) for key in CONTRACT_NAMES]
    expiring = [key for key, expiries in calendar.items() if expiries and expiries[0]["label"] == "Today"]
    close = dt.datetime.combine(today, MARKET_CLOSE, tzinfo=MARKET_TZ)
    return {
        "cards": cards, "mustKnow": must_know(now, cards, calendar, notes, ban_list(today)), "calendar": calendar,
        "expiryToday": expiring, "marketOpen": market_open(now),
        "lastHour": bool(expiring and market_open(now) and now.time() >= EXPIRY_LAST_HOUR),
        "closesAt": int(close.timestamp()), "now": int(now.timestamp()), "disclaimer": DISCLAIMER,
        "optionCost": option_cost(india_vix()) if market_open(now) else None,
    }


@never_cache
@require_GET
def decision(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        return JsonResponse({"type": "success", **decision_payload()})
    except (OSError, KeyError):
        return JsonResponse({"type": "error", "message": "Market data is unavailable right now."}, status=503)

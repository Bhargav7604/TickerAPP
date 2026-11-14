"""Option chain, OI build-up and trending-OI analysis over recorded three-minute snapshots."""
import datetime as dt
import math
from collections import defaultdict

from types import SimpleNamespace

from django.db.models import Max
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .equity import QUOTE_CACHE_ID, broker, cache_retry_ms, cached_broker_result, catalogue
from .market_contracts import MARKET_TZ, market_today
from .models import LiveMarketFeed, OptionOIBaseline, OptionOISnapshot
from .oi_recorder import OPTION_INDEXES, SPOT_KEYS, is_recording_time, quote_all, select_strikes
from .views import protected

RISK_FREE_RATE = 0.065
EXPIRY_CLOSE = dt.time(15, 30)
INTERVALS = (3, 6, 15, 30, 60)
STRIKE_WINDOWS = (5, 7, 10, 15)
DEFAULT_CHANGE_WINDOW = 15  # minutes; the chain's short-term OI change, recorded OI being three minutes apart
LIVE_QUOTE_TTL = 3
LIVE_STRIKES_EACH_SIDE = 12   # "ATM ±12": 25 strikes on screen
STRIKE_RANGES = ("atm", "all")
FULL_CHAIN_TTL = 60           # far strikes only feed max pain, so their OI is refreshed once a minute
# Keys in the shared quote cache are namespaced so they never collide with the Equity pages' quote format.
LIVE_KEY_PREFIX = "oi|"
NO_DATA = ("No OI recorded yet for this expiry. OI is saved every 3 minutes during market hours "
           "while Zerodha is connected.")


def _cdf(value):
    return 0.5 * (1 + math.erf(value / math.sqrt(2)))


def option_price(spot, strike, years, vol, option_type, rate=RISK_FREE_RATE):
    root = vol * math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / root
    d2 = d1 - root
    discounted = strike * math.exp(-rate * years)
    if option_type == "CE":
        return spot * _cdf(d1) - discounted * _cdf(d2)
    return discounted * _cdf(-d2) - spot * _cdf(-d1)


def implied_volatility(price, spot, strike, years, option_type):
    """Black-Scholes IV in percent, or None when the premium is at or below intrinsic value."""
    if not price or not spot or not strike or years <= 0:
        return None
    discounted = strike * math.exp(-RISK_FREE_RATE * years)
    intrinsic = max(0.0, spot - discounted) if option_type == "CE" else max(0.0, discounted - spot)
    if price <= intrinsic + 1e-6:
        return None
    low, high = 0.001, 5.0
    if option_price(spot, strike, years, high, option_type) < price:
        return None
    for _ in range(60):
        middle = (low + high) / 2
        if option_price(spot, strike, years, middle, option_type) < price:
            low = middle
        else:
            high = middle
    return round((low + high) / 2 * 100, 2)


def decay_and_odds(spot, strike, years, option_type, iv):
    """(rupees lost per unit per hour from time decay, % chance of finishing in the money) from Black-Scholes."""
    if not iv or not spot or years <= 0:
        return None, None
    vol = iv / 100
    root = vol * math.sqrt(years)
    d1 = (math.log(spot / strike) + (RISK_FREE_RATE + vol * vol / 2) * years) / root
    d2 = d1 - root
    density = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    carry = RISK_FREE_RATE * strike * math.exp(-RISK_FREE_RATE * years)
    theta = -spot * density * vol / (2 * math.sqrt(years)) - (carry * _cdf(d2) if option_type == "CE" else -carry * _cdf(-d2))
    odds = _cdf(d2) if option_type == "CE" else _cdf(-d2)
    return -theta / (365 * 24), odds * 100


def option_delta(spot, strike, years, option_type, iv):
    """Black-Scholes delta: how much the premium moves for a one-point move in the index."""
    if not iv or not spot or years <= 0:
        return None
    vol = iv / 100
    d1 = (math.log(spot / strike) + (RISK_FREE_RATE + vol * vol / 2) * years) / (vol * math.sqrt(years))
    return round(_cdf(d1) if option_type == "CE" else _cdf(d1) - 1, 2)


def max_pain(open_interest):
    """The expiry price at which option buyers, all together, would get the least: {(strike, type): oi} in."""
    strikes = sorted({strike for strike, _ in open_interest})
    if not strikes:
        return None

    def payout(price):
        return sum(oi * (max(0.0, price - strike) if option_type == "CE" else max(0.0, strike - price))
                   for (strike, option_type), oi in open_interest.items())

    return min(strikes, key=payout)


def buildup(ltp_change, oi_change):
    if not ltp_change or not oi_change:
        return None
    if oi_change > 0:
        return "Long Build-up" if ltp_change > 0 else "Short Build-up"
    return "Short Covering" if ltp_change > 0 else "Long Unwinding"


def years_to_expiry(expiry, at):
    close = dt.datetime.combine(expiry, EXPIRY_CLOSE)
    return max((close - at).total_seconds(), 0) / (365 * 24 * 3600)


def epoch(naive_ist):
    return int(naive_ist.replace(tzinfo=MARKET_TZ).timestamp())


def ratio(numerator, denominator):
    return round(numerator / denominator, 2) if denominator else None


def latest_day(index_key, expiry):
    latest = OptionOISnapshot.objects.filter(index_key=index_key, expiry=expiry).aggregate(Max("bucket_time"))["bucket_time__max"]
    return latest.date() if latest else None


def day_snapshots(index_key, expiry, day):
    start = dt.datetime.combine(day, dt.time.min)
    rows = OptionOISnapshot.objects.filter(index_key=index_key, expiry=expiry, bucket_time__gte=start,
                                           bucket_time__lt=start + dt.timedelta(days=1)).order_by("bucket_time")
    buckets = defaultdict(dict)
    for row in rows:
        buckets[row.bucket_time][(row.strike, row.option_type)] = row
    return dict(sorted(buckets.items()))


def baselines(index_key, expiry, day, buckets, items):
    """Previous-close OI for every item, or (until history arrives) today's first snapshot for all of them.

    Mixing the two would add 'since yesterday' and 'since this morning' changes into one total.
    """
    known = {(row.strike, row.option_type): row.prev_oi
             for row in OptionOIBaseline.objects.filter(index_key=index_key, expiry=expiry, trade_date=day)}
    if all(item in known for item in items):
        return known, "previous close"
    first = {}
    for rows in buckets.values():
        for item, row in rows.items():
            first.setdefault(item, row.oi)
    return first, "today's first snapshot"


def parse_strike_range(request):
    strike_range = request.GET.get("range", "atm")
    if strike_range not in STRIKE_RANGES:
        raise ValueError("Choose ATM ±12 or the whole chain.")
    return strike_range


def parse_change_window(request):
    try:
        minutes = int(request.GET.get("window", DEFAULT_CHANGE_WINDOW))
    except ValueError:
        raise ValueError("Choose an OI change window of 3, 6, 15, 30 or 60 minutes.")
    if minutes not in INTERVALS:
        raise ValueError("Choose an OI change window of 3, 6, 15, 30 or 60 minutes.")
    return minutes


def add_window_change(chain, buckets, at, minutes):
    """OI change and build-up since the last recording at least `minutes` before `at` (both naive IST)."""
    earlier = [time for time in buckets if time <= at - dt.timedelta(minutes=minutes)]
    since = earlier[-1] if earlier else None
    before = buckets[since] if since else {}
    totals = {"call": 0.0, "put": 0.0}
    for row in chain["rows"]:
        for option_type, side in (("CE", "call"), ("PE", "put")):
            if row.get(side) is None:
                continue
            old = before.get((row["strike"], option_type))
            change = row[side]["oi"] - old.oi if old else None
            premium = row[side]["ltp"] - old.ltp if old and old.ltp is not None and row[side]["ltp"] is not None else None
            row[side]["oiChangeWindow"] = change
            row[side]["buildupWindow"] = buildup(premium, change)
            totals[side] += change or 0
    first = next(iter(buckets), None)
    recorded = int((at - first).total_seconds() // 60) if first and at >= first else 0
    return {**chain, "window": minutes, "windowFrom": epoch(since) if since else None,
            "windowTotals": {"callOiChange": round(totals["call"]), "putOiChange": round(totals["put"])} if since else None,
            "windowStatus": {"ready": since is not None, "minutesRecorded": min(recorded, minutes), "snapshots": len(buckets)}}


def keep_near_atm(latest, underlying, each_side=LIVE_STRIKES_EACH_SIDE):
    strikes = select_strikes([strike for strike, _ in latest], underlying, each_side=each_side)
    return {item: snap for item, snap in latest.items() if item[0] in strikes}


def atm_strike(strikes, underlying):
    return min(strikes, key=lambda strike: abs(strike - underlying)) if strikes and underlying else None


def parse_request(request, need_interval=False):
    index_key = request.GET.get("index", "nifty")
    if index_key not in OPTION_INDEXES:
        raise ValueError("Select NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY or SENSEX.")
    try:
        expiry = dt.date.fromisoformat(request.GET.get("expiry", ""))
    except ValueError:
        raise ValueError("Select a valid expiry.")
    if not need_interval:
        return index_key, expiry
    try:
        interval, window = int(request.GET.get("interval", "3")), int(request.GET.get("strikes", "7"))
    except ValueError:
        raise ValueError("Invalid interval or strike range.")
    if interval not in INTERVALS or window not in STRIKE_WINDOWS:
        raise ValueError("Invalid interval or strike range.")
    return index_key, expiry, interval, window


LOTTERY_ODDS_PCT = 5


def build_chain(latest, base, underlying, at, lot_size=None):
    """Rows, totals and OI extremes for {(strike, type): quote-like object with oi/ltp/prev_close/volume}."""
    strikes = sorted({strike for strike, _ in latest})
    rows, totals = [], defaultdict(float)
    for strike in strikes:
        row = {"strike": strike}
        for option_type, side in (("CE", "call"), ("PE", "put")):
            snap = latest.get((strike, option_type))
            if not snap:
                row[side] = None
                continue
            prior = base.get((strike, option_type))
            oi_change = snap.oi - prior if prior is not None else None
            ltp_change = round(snap.ltp - snap.prev_close, 2) if snap.ltp is not None and snap.prev_close else None
            iv = implied_volatility(snap.ltp, underlying, strike, snap.years, option_type)
            decay, odds = decay_and_odds(underlying, strike, snap.years, option_type, iv)
            out_of_money = underlying is not None and (strike > underlying if option_type == "CE" else strike < underlying)
            row[side] = {
                "oi": snap.oi, "oiChange": oi_change,
                "oiChangePct": ratio(oi_change * 100, prior) if oi_change is not None else None,
                "ltp": snap.ltp, "ltpChange": ltp_change, "ltpChangePct": ratio(ltp_change * 100, snap.prev_close) if ltp_change is not None else None,
                "iv": iv, "delta": option_delta(underlying, strike, snap.years, option_type, iv),
                "buildup": buildup(ltp_change, oi_change), "volume": snap.volume,
                "decayPerHour": round(decay * lot_size) if decay is not None and lot_size else None,
                "chanceItm": round(odds, 1) if odds is not None else None,
                "lottery": bool(out_of_money and odds is not None and odds < LOTTERY_ODDS_PCT),
            }
            totals[side + "Oi"] += snap.oi
            totals[side + "OiChange"] += oi_change or 0
        row["pcr"] = ratio(row["put"]["oi"], row["call"]["oi"]) if row.get("call") and row.get("put") else None
        rows.append(row)
    calls = [row for row in rows if row["call"]]
    puts = [row for row in rows if row["put"]]
    atm = atm_strike(strikes, underlying)
    atm_row = next((row for row in rows if row["strike"] == atm), {})
    atm_ivs = [side["iv"] for side in (atm_row.get("call"), atm_row.get("put")) if side and side["iv"]]
    return {
        "rows": rows, "underlying": underlying, "atm": atm, "bucketTime": epoch(at), "lotSize": lot_size,
        "atmIv": round(sum(atm_ivs) / len(atm_ivs), 1) if atm_ivs else None,
        "totals": {**{key: round(value) for key, value in totals.items()},
                   "pcr": ratio(totals["putOi"], totals["callOi"]),
                   "changePcr": ratio(totals["putOiChange"], totals["callOiChange"]) if totals["callOiChange"] > 0 else None},
        "maxCallOiStrike": max(calls, key=lambda row: row["call"]["oi"])["strike"] if calls else None,
        "maxPutOiStrike": max(puts, key=lambda row: row["put"]["oi"])["strike"] if puts else None,
        "message": "",
    }


def lot_size_for(index_key, expiry):
    try:
        frame = catalogue(index_options=True)
        rows = frame[frame["name"].eq(OPTION_INDEXES[index_key]) & frame["expiry"].dt.date.eq(expiry)]
        return int(rows["lot_size"].iloc[0]) if not rows.empty else None
    except (OSError, KeyError):
        return None


def listed_strike_count(index_key, expiry):
    try:
        frame = catalogue(index_options=True)
        return int(frame[frame["name"].eq(OPTION_INDEXES[index_key]) & frame["expiry"].dt.date.eq(expiry)]["strike"].nunique()) or None
    except (OSError, KeyError):
        return None


def chain_payload(index_key, expiry, window=DEFAULT_CHANGE_WINDOW, strike_range="atm"):
    day = latest_day(index_key, expiry)
    if not day:
        return {"rows": [], "message": NO_DATA}
    buckets = day_snapshots(index_key, expiry, day)
    bucket_time, latest = list(buckets.items())[-1]
    base, baseline_source = baselines(index_key, expiry, day, buckets, list(latest))
    underlying = next((row.underlying for row in latest.values() if row.underlying), None)
    years = years_to_expiry(expiry, bucket_time)
    for snap in latest.values():
        snap.years = years
    shown = keep_near_atm(latest, underlying) if strike_range == "atm" else latest
    chain = build_chain(shown, base, underlying, bucket_time, lot_size_for(index_key, expiry))
    return {**add_window_change(chain, buckets, bucket_time, window), "baseline": baseline_source, "expiry": expiry.isoformat(),
            "range": strike_range, "totalStrikes": listed_strike_count(index_key, expiry) or len({strike for strike, _ in latest}),
            "maxPain": max_pain({item: snap.oi for item, snap in latest.items()}), "marketOpen": False}


def live_spot(index_key):
    """Spot from the streaming index feed when it is live, else the latest recorded underlying."""
    state = LiveMarketFeed.objects.filter(pk=1).first()
    if state and state.payload.get("status") == "live" and (timezone.now() - state.updated_at).total_seconds() < 15:
        token = state.payload.get("spotTokens", {}).get(index_key)
        price = (state.payload.get("ticks", {}).get(str(token)) or {}).get("last_price")
        if price:
            return price
    return (OptionOISnapshot.objects.filter(index_key=index_key, underlying__isnull=False)
            .order_by("-bucket_time").values_list("underlying", flat=True).first())


def live_chain_payload(index_key, expiry, window=DEFAULT_CHANGE_WINDOW, strike_range="atm"):
    client, session = broker()
    if not client:
        return {"rows": [], "live": False, "message": "Zerodha session is not connected. Refresh the token in admin."}
    frame = catalogue(index_options=True)
    listed = frame[frame["name"].eq(OPTION_INDEXES[index_key]) & frame["expiry"].dt.date.eq(expiry)]
    if listed.empty:
        raise ValueError("Select an available expiry.")
    spot_key = LIVE_KEY_PREFIX + SPOT_KEYS[index_key]

    def fetch(missing):
        raw = quote_all(client, [key[len(LIVE_KEY_PREFIX):] for key in missing])
        return {LIVE_KEY_PREFIX + name: {"oi": quote.get("oi"), "ltp": quote.get("last_price"),
                                         "close": (quote.get("ohlc") or {}).get("close"), "volume": quote.get("volume")}
                for name, quote in raw.items()}

    spot = live_spot(index_key)
    if spot is None:
        # No streaming feed or recording yet: price the index first so the strike window can centre on ATM.
        first = cached_broker_result(QUOTE_CACHE_ID, session, [spot_key], LIVE_QUOTE_TTL, fetch)
        spot = ((first.get(spot_key) or {}).get("data") or {}).get("ltp")
        if spot is None:
            return {"rows": [], "live": True, "retryAfterMs": 1000, "message": "Loading live option quotes..."}
    every = {f"{LIVE_KEY_PREFIX}{row.exchange}:{row.tradingsymbol}": (float(row.strike), row.instrument_type) for row in listed.itertuples()}
    if strike_range == "atm":
        strikes = set(select_strikes(listed["strike"].astype(float).tolist(), spot, each_side=LIVE_STRIKES_EACH_SIDE))
        names = {key: item for key, item in every.items() if item[0] in strikes}
    else:
        names = every
    chosen = listed[listed["strike"].astype(float).isin({strike for strike, _ in names.values()})]
    keys = [spot_key, *names]
    # Max pain needs every strike's OI; outside the visible strikes a minute-old OI is plenty. One fetch, so one lock.
    whole = cached_broker_result(QUOTE_CACHE_ID, session, [*keys, *(key for key in every if key not in names)],
                                 lambda key: LIVE_QUOTE_TTL if key == spot_key or key in names else FULL_CHAIN_TTL, fetch)
    entries = {key: whole[key] for key in keys if key in whole}
    retry = cache_retry_ms(QUOTE_CACHE_ID, entries, keys, LIVE_QUOTE_TTL)
    open_interest = {every[key]: float(entry["data"]["oi"]) for key, entry in whole.items()
                     if key in every and entry.get("data") and entry["data"].get("oi") is not None}
    now = dt.datetime.now(MARKET_TZ).replace(tzinfo=None)
    years = years_to_expiry(expiry, now)
    latest = {}
    for key, (strike, option_type) in names.items():
        data = (entries.get(key) or {}).get("data")
        if data and data.get("oi") is not None:
            latest[(strike, option_type)] = SimpleNamespace(oi=float(data["oi"]), ltp=data.get("ltp"), prev_close=data.get("close"),
                                                           volume=data.get("volume"), years=years)
    if not latest:
        return {"rows": [], "live": True, "retryAfterMs": retry or 1000, "message": "Loading live option quotes..."}
    buckets = day_snapshots(index_key, expiry, now.date())
    # Only strikes the recorder follows have a day baseline; the far strikes of a whole-chain view show no day change.
    recorded = {item for rows in buckets.values() for item in rows}
    base, baseline_source = baselines(index_key, expiry, now.date(), buckets, [item for item in latest if item in recorded] or list(latest))
    if baseline_source != "previous close" and not buckets:
        baseline_source = "unavailable"
    spot = (entries.get(spot_key, {}).get("data") or {}).get("ltp") or spot
    fetched = [entry["at"] for key, entry in entries.items() if key != spot_key and entry.get("data")]
    lot_size = int(chosen["lot_size"].iloc[0]) if "lot_size" in chosen and not chosen.empty else lot_size_for(index_key, expiry)
    chain = add_window_change(build_chain(latest, base, spot, now, lot_size), buckets, now, window)
    return {**chain, "bucketTime": int(min(fetched)), "baseline": baseline_source, "live": True, "retryAfterMs": retry,
            "expiry": expiry.isoformat(), "range": strike_range, "totalStrikes": len({strike for strike, _ in every.values()}),
            "maxPain": max_pain(open_interest), "marketOpen": is_recording_time(dt.datetime.now(MARKET_TZ))}


def trend_payload(index_key, expiry, interval, window, day=None):
    day = day or latest_day(index_key, expiry)
    if not day:
        return {"rows": [], "series": [], "message": NO_DATA}
    buckets = day_snapshots(index_key, expiry, day)
    latest = list(buckets.values())[-1]
    underlying = next((row.underlying for row in latest.values() if row.underlying), None)
    strikes = sorted({strike for strike, _ in latest})
    atm = atm_strike(strikes, underlying)
    position = strikes.index(atm) if atm is not None else 0
    selected = strikes[max(0, position - window):position + window + 1]
    base, baseline_source = baselines(index_key, expiry, day, buckets, [(s, t) for s in selected for t in ("CE", "PE")])
    times = list(buckets)
    shown = {times[0], times[-1]} | {time for time in times if (time.hour * 60 + time.minute) % interval == 0}
    rows, previous = [], None
    day_high = day_low = None
    for bucket_time, snaps in buckets.items():
        spot = next((row.underlying for row in snaps.values() if row.underlying), None)
        breaks = None
        if spot is not None and day_high is not None:
            breaks = {"type": "DHB", "level": day_high} if spot > day_high else {"type": "DLB", "level": day_low} if spot < day_low else None
        if spot is not None:
            day_high, day_low = max(day_high or spot, spot), min(day_low or spot, spot)
        if bucket_time not in shown:
            continue
        sums = defaultdict(float)
        for strike in selected:
            for option_type, side in (("CE", "call"), ("PE", "put")):
                snap = snaps.get((strike, option_type))
                if snap:
                    sums[side + "Change"] += snap.oi - base.get((strike, option_type), snap.oi)
                    sums[side + "Oi"] += snap.oi
                    sums[side + "Ltp"] += snap.ltp or 0
        call, put = sums["callChange"], sums["putChange"]
        diff = put - call
        largest = max(abs(call), abs(put))
        row = {
            "time": epoch(bucket_time), "underlying": spot, "dayBreak": breaks,
            "callOiChange": round(call), "putOiChange": round(put), "diff": round(diff),
            "strength": round(diff / largest * 100) if largest else 0,
            "changePcr": ratio(put, call) if call > 0 else None, "oiPcr": ratio(sums["putOi"], sums["callOi"]),
            "callLtp": round(sums["callLtp"], 2), "putLtp": round(sums["putLtp"], 2),
            "sentiment": "Bullish" if diff > 0 else "Bearish" if diff < 0 else "Neutral",
        }
        if previous:
            row["diffChange"] = row["diff"] - previous["diff"]
            row["diffChangePct"] = ratio(row["diffChange"] * 100, abs(previous["diff"]))
            row["callLtpChange"] = round(row["callLtp"] - previous["callLtp"], 2)
            row["putLtpChange"] = round(row["putLtp"] - previous["putLtp"], 2)
        rows.append(row)
        previous = row
    return {"rows": rows[::-1], "series": rows, "strikes": selected, "atm": atm, "underlying": underlying,
            "interval": interval, "baseline": baseline_source, "message": ""}


def expiries_payload(index_key):
    today = market_today()
    recorded = sorted(set(OptionOISnapshot.objects.filter(
        index_key=index_key, expiry__gte=today).values_list("expiry", flat=True)))
    frame = catalogue(index_options=True)
    listed = sorted(frame[frame["name"].eq(OPTION_INDEXES[index_key])]["expiry"].dt.date.unique())[:2]
    expiries = sorted(set(recorded) | set(listed))
    return {"expiries": [expiry.isoformat() for expiry in expiries],
            "recorded": [expiry.isoformat() for expiry in recorded],
            "intervals": list(INTERVALS), "strikeWindows": list(STRIKE_WINDOWS)}


def _respond(request, build, need_interval=False):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        return JsonResponse({"type": "success", **build(*parse_request(request, need_interval))})
    except ValueError as exc:
        return JsonResponse({"type": "error", "message": str(exc)}, status=400)
    except Exception:
        return JsonResponse({"type": "error", "message": "Live option quotes are unavailable. Check the Zerodha session in admin."}, status=503)


@never_cache
@require_GET
def oi_expiries(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    index_key = request.GET.get("index", "nifty")
    if index_key not in OPTION_INDEXES:
        return JsonResponse({"type": "error", "message": "Select NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY or SENSEX."}, status=400)
    try:
        return JsonResponse({"type": "success", **expiries_payload(index_key)})
    except (OSError, KeyError):
        return JsonResponse({"type": "error", "message": "Instrument catalogue unavailable."}, status=503)


@never_cache
@require_GET
def oi_chain(request):
    return _respond(request, lambda index_key, expiry: chain_payload(index_key, expiry, parse_change_window(request), parse_strike_range(request)))


@never_cache
@require_GET
def oi_trend(request):
    return _respond(request, trend_payload, need_interval=True)


@never_cache
@require_GET
def oi_live_chain(request):
    return _respond(request, lambda index_key, expiry: live_chain_payload(index_key, expiry, parse_change_window(request), parse_strike_range(request)))

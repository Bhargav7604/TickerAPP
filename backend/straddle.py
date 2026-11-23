"""Straddle and strangle prices through the session, for the index option chains the OI recorder follows.

ATM is the strike nearest the synthetic future (strike + call - put at the strike nearest spot), so a gap between spot and
futures never picks the wrong strike. OTM n pairs the call n strikes above ATM with the put n strikes below; ITM 1 pairs
the call one strike below with the put one strike above. The recorded three-minute snapshots draw the day, and while the
market is open a live quote (the OI page's shared three-second cache) adds the latest point.
"""
import datetime as dt
import threading
from bisect import bisect_left

from django.db.models import Count, Max
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .equity import QUOTE_CACHE_ID, broker, cached_broker_result, catalogue
from .logger import log
from .market_contracts import MARKET_TZ
from .models import OptionOISnapshot
from .oi_analysis import LIVE_KEY_PREFIX, LIVE_QUOTE_TTL, NO_DATA, day_snapshots, epoch, live_quote_fetcher, live_spot, parse_request
from .oi_recorder import OPTION_INDEXES, SPOT_KEYS, is_recording_time, select_strikes
from .views import protected

# (line, offset): the call sits `offset` strikes above ATM and the put `offset` strikes below.
LINES = (("ITM1", -1), ("ATM", 0)) + tuple((f"OTM{n}", n) for n in range(1, 8))
LIVE_STRIKES_EACH_SIDE = 9   # OTM 7 needs seven strikes either side of ATM, and ATM can sit a strike away from spot
SERIES_CACHE_SIZE = 40
_series_cache = {}
_series_lock = threading.Lock()


def nearest(strikes, price):
    """Index of the strike nearest a price in a sorted list."""
    position = bisect_left(strikes, price)
    return min((i for i in (position - 1, position) if 0 <= i < len(strikes)), key=lambda i: abs(strikes[i] - price))


def atm_and_synthetic(strikes, prices, spot):
    """(index of the ATM strike, synthetic future) from {(strike, "CE"|"PE"): price}. No call/put pair falls back to spot."""
    if not strikes or spot is None:
        return None, None
    near = nearest(strikes, spot)
    call, put = prices.get((strikes[near], "CE")), prices.get((strikes[near], "PE"))
    synthetic = round(strikes[near] + call - put, 2) if call is not None and put is not None else None
    return nearest(strikes, synthetic if synthetic is not None else spot), synthetic


def ladder(strikes, prices, atm):
    """The ITM 1, ATM and OTM 1-7 rows: each call and put strike, their prices and the pair's total."""
    rows = []
    for key, offset in LINES:
        call_at, put_at = atm + offset, atm - offset
        if not (0 <= call_at < len(strikes) and 0 <= put_at < len(strikes)):
            rows.append({"key": key, "ceStrike": None, "ce": None, "peStrike": None, "pe": None, "total": None})
            continue
        call, put = prices.get((strikes[call_at], "CE")), prices.get((strikes[put_at], "PE"))
        rows.append({"key": key, "ceStrike": strikes[call_at], "ce": call, "peStrike": strikes[put_at], "pe": put,
                     "total": round(call + put, 2) if call is not None and put is not None else None})
    return rows


def point(at, strikes, prices, spot):
    atm, synthetic = atm_and_synthetic(strikes, prices, spot)
    if atm is None:
        return None
    return {"at": at, "spot": spot, "synthetic": synthetic, "atm": strikes[atm], "rows": ladder(strikes, prices, atm)}


def build_series(buckets):
    """(series, last point) from {bucket_time: {(strike, type): snapshot}}. A strike with no price that bucket leaves a gap."""
    strikes = sorted({strike for snaps in buckets.values() for strike, _ in snaps})
    series = {"times": [], "spot": [], "synthetic": [], "atm": [], "lines": {key: [] for key, _ in LINES}}
    last = None
    for bucket_time, snaps in buckets.items():
        prices = {item: row.ltp for item, row in snaps.items() if row.ltp}
        spot = next((row.underlying for row in snaps.values() if row.underlying), None)
        current = point(epoch(bucket_time), strikes, prices, spot)
        if current is None:
            continue
        append_point(series, current)
        last = current
    return series, last


def append_point(series, current):
    series["times"].append(current["at"])
    series["spot"].append(current["spot"])
    series["synthetic"].append(current["synthetic"])
    series["atm"].append(current["atm"])
    for row in current["rows"]:
        series["lines"][row["key"]].append(row["total"])


def day_range(day):
    start = dt.datetime.combine(day, dt.time.min)
    return start, start + dt.timedelta(days=1)


def cached_series(index_key, expiry, day):
    """The day's series, rebuilt only when the recorder or its history backfill has added rows."""
    start, end = day_range(day)
    stamp = tuple(OptionOISnapshot.objects.filter(index_key=index_key, expiry=expiry, bucket_time__gte=start, bucket_time__lt=end)
                  .aggregate(latest=Max("bucket_time"), rows=Count("id")).values())
    key = (index_key, expiry, day)
    with _series_lock:
        hit = _series_cache.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
    value = build_series(day_snapshots(index_key, expiry, day))
    with _series_lock:
        _series_cache[key] = (stamp, value)
        while len(_series_cache) > SERIES_CACHE_SIZE:
            _series_cache.pop(next(iter(_series_cache)))
    return value


def clear_cache():
    with _series_lock:
        _series_cache.clear()


def recorded_days(index_key, expiry):
    times = OptionOISnapshot.objects.filter(index_key=index_key, expiry=expiry).values_list("bucket_time", flat=True).distinct()
    return sorted({moment.date() for moment in times}, reverse=True)


def live_point(index_key, expiry):
    """The ladder from live quotes, or None when Zerodha is not connected or the expiry is not listed."""
    client, session = broker()
    if not client:
        return None
    frame = catalogue(index_options=True)
    listed = frame[frame["name"].eq(OPTION_INDEXES[index_key]) & frame["expiry"].dt.date.eq(expiry)]
    if listed.empty:
        return None
    spot_key = LIVE_KEY_PREFIX + SPOT_KEYS[index_key]
    every = {f"{LIVE_KEY_PREFIX}{row.exchange}:{row.tradingsymbol}": (float(row.strike), row.instrument_type) for row in listed.itertuples()}
    spot = live_spot(index_key)
    if spot is None:
        # Nothing streamed or recorded yet: one request prices the index with the whole expiry (a few hundred quotes at most),
        # since a second request straight after would land in the shared cache's cooldown.
        names = every
    else:
        chosen = set(select_strikes([strike for strike, _ in every.values()], spot, each_side=LIVE_STRIKES_EACH_SIDE))
        names = {key: item for key, item in every.items() if item[0] in chosen}
    entries = cached_broker_result(QUOTE_CACHE_ID, session, [spot_key, *names], LIVE_QUOTE_TTL, live_quote_fetcher(client))
    prices = {}
    for key, item in names.items():
        price = ((entries.get(key) or {}).get("data") or {}).get("ltp")
        if price:
            prices[item] = price
    fetched = [entry["at"] for key, entry in entries.items() if key != spot_key and entry.get("data")]
    if not prices or not fetched:
        return None
    spot = ((entries.get(spot_key) or {}).get("data") or {}).get("ltp") or spot
    return point(int(min(fetched)), sorted({strike for strike, _ in names.values()}), prices, spot)


def straddle_payload(index_key, expiry, day=None, now=None):
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    days = recorded_days(index_key, expiry)
    day = day or (days[0] if days else today)
    series, last = cached_series(index_key, expiry, day) if day in days else build_series({})
    live = None
    if day == today and (is_recording_time(now) or last is None):
        try:
            live = live_point(index_key, expiry)
        except Exception as exc:
            log(f"Straddle live quote unavailable ({type(exc).__name__}: {exc}).", "ERROR")
    if live and (not series["times"] or live["at"] > series["times"][-1]):
        # A copy: the cached series must not grow with every request.
        series = {"times": [*series["times"]], "spot": [*series["spot"]], "synthetic": [*series["synthetic"]], "atm": [*series["atm"]],
                  "lines": {key: [*values] for key, values in series["lines"].items()}}
        append_point(series, live)
    current = live or last
    return {"index": index_key, "label": OPTION_INDEXES[index_key], "expiry": expiry.isoformat(), "day": day.isoformat(),
            "days": [item.isoformat() for item in days], "dte": (expiry - today).days, "live": live is not None,
            "current": current, "series": series, "marketOpen": is_recording_time(now), "message": "" if current else NO_DATA}


@gzip_page
@never_cache
@require_GET
def straddle(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        index_key, expiry = parse_request(request)
    except ValueError as exc:
        return JsonResponse({"type": "error", "message": str(exc)}, status=400)
    try:
        day = dt.date.fromisoformat(request.GET["day"]) if request.GET.get("day") else None
    except ValueError:
        return JsonResponse({"type": "error", "message": "Select a valid day."}, status=400)
    try:
        return JsonResponse({"type": "success", **straddle_payload(index_key, expiry, day)})
    except (OSError, KeyError):
        return JsonResponse({"type": "error", "message": "Instrument catalogue unavailable."}, status=503)

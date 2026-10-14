"""Server-side accumulation / distribution signal analysis for ATM options.

Replaces the JavaScript logic that previously lived in
frontend/gui/src/components/dashboard.jsx (getAcDdAnalysis,
aggregateAcDdPoints, combineAcDdAnalyses, getAtmOptionGroups) and
frontend/gui/src/App.js (checkAcDdAlerts and its helpers). The shape this
module returns mirrors what those frontend functions produced so the UI
only needs to render rather than compute.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from .market_contracts import CONTRACT_NAMES
from .models import MarketSnapshot


MARKET_TZ = ZoneInfo("Asia/Kolkata")
OPTION_TYPES = ("CE", "PE")
PRICE_THRESHOLD_PCT = 0.2
VOLUME_THRESHOLD_PCT = 250.0
LOOKBACK_BARS = 25
SNAPSHOT_INTERVAL_MINUTES = 5
MARKET_OPEN_MINUTES = (9 * 60) + 15
MARKET_CLOSE_MINUTES = (15 * 60) + 30
ATM_STRIKE_DISTANCE_BY_INDEX = {
    "nifty": 75.0,
    "banknifty": 150.0,
    "sensex": 150.0,
}


def _to_market_aware(value):
    return value.replace(tzinfo=MARKET_TZ) if value.tzinfo is None else value.astimezone(MARKET_TZ)


def _market_timestamp_ms(value):
    return int(_to_market_aware(value).timestamp() * 1000)


def _market_minutes(value):
    return (value.hour * 60) + value.minute


def _is_market_time(value):
    minutes = _market_minutes(value)
    return value.weekday() < 5 and MARKET_OPEN_MINUTES <= minutes <= MARKET_CLOSE_MINUTES


def _today_bounds():
    today = dt.datetime.now(MARKET_TZ).date()
    start = dt.datetime.combine(today, dt.time.min)
    end = start + dt.timedelta(days=1)
    return start, end


def _snapshot_to_point(snapshot):
    return {
        "time": _market_timestamp_ms(snapshot.bucket_time),
        "symbol": snapshot.symbol,
        "strike": snapshot.strike,
        "instrumentType": snapshot.instrument_type,
        "indexLevel": snapshot.index_level,
        "volumeTraded": snapshot.volume_traded,
        "intervalVolume": snapshot.interval_volume,
        "vwap": snapshot.vwap,
    }


def _load_future_levels(contract_month, start, end):
    queryset = MarketSnapshot.objects.filter(
        bucket_time__gte=start,
        bucket_time__lt=end,
        contract_month=contract_month,
        instrument_type="FUT",
    )

    return {
        (snapshot.index_key, snapshot.bucket_time): snapshot.index_level
        for snapshot in queryset
        if snapshot.index_key in CONTRACT_NAMES and snapshot.index_level not in (None, 0)
    }


def _is_near_atm(snapshot, future_levels):
    future_level = future_levels.get((snapshot.index_key, snapshot.bucket_time))
    if future_level in (None, 0):
        return True

    max_distance = ATM_STRIKE_DISTANCE_BY_INDEX.get(snapshot.index_key, future_level * 0.002)
    return abs(snapshot.strike - future_level) <= max_distance


def _group_by_symbol(points):
    groups = {}
    for point in points:
        groups.setdefault(point["symbol"], []).append(point)
    return [
        sorted(symbol_points, key=lambda p: p["time"])
        for symbol_points in groups.values()
        if len(symbol_points) > 1
    ]


def _aggregate_to_timeframe(points, timeframe_minutes):
    if timeframe_minutes <= SNAPSHOT_INTERVAL_MINUTES:
        return list(points)

    buckets = {}
    for point in points:
        time_ms = point["time"]
        local = dt.datetime.fromtimestamp(time_ms / 1000, MARKET_TZ)
        minutes = _market_minutes(local)
        bucket_offset_ms = (minutes % timeframe_minutes) * 60 * 1000
        bucket_time = time_ms - bucket_offset_ms

        interval_volume = point.get("intervalVolume")
        existing = buckets.get(bucket_time)

        if existing is None:
            buckets[bucket_time] = {
                **point,
                "time": bucket_time,
                "lastSourceTime": point["time"],
                "intervalVolume": interval_volume,
            }
            continue

        if point["time"] >= existing["lastSourceTime"]:
            existing["symbol"] = point["symbol"]
            existing["strike"] = point["strike"]
            existing["instrumentType"] = point["instrumentType"]
            existing["indexLevel"] = point["indexLevel"]
            existing["volumeTraded"] = point.get("volumeTraded")
            existing["vwap"] = point.get("vwap")
            existing["lastSourceTime"] = point["time"]

        if interval_volume is not None:
            existing["intervalVolume"] = (existing.get("intervalVolume") or 0) + interval_volume

    return sorted(buckets.values(), key=lambda p: p["time"])


def _analyze_group(points, timeframe_minutes):
    # Drop the very first bar of the trading day before analysis. Its
    # intervalVolume was computed against yesterday's last cumulative
    # volume (a baseline that does not survive the daily volume reset),
    # and its indexLevel can still hold the prior session's settlement
    # for instruments that hadn't traded yet at 09:15. Using it as a
    # comparison baseline produces phantom 10,000%+ volume surges and
    # double-digit price changes on the second bar of the day.
    points = points[1:] if points else points
    analysis_points = points[-(LOOKBACK_BARS + 1):]
    rows = []
    ac_count = 0
    dd_count = 0
    has_volume = False
    expected_gap_ms = timeframe_minutes * 60 * 1000

    for index in range(1, len(analysis_points)):
        previous = analysis_points[index - 1]
        current = analysis_points[index]

        gap_ms = current["time"] - previous["time"]
        if abs(gap_ms - expected_gap_ms) > 1000:
            continue

        previous_close = previous.get("indexLevel")
        current_close = current.get("indexLevel")
        if previous_close in (None, 0) or current_close is None:
            continue

        previous_volume = previous.get("intervalVolume")
        current_volume = current.get("intervalVolume")
        if previous_volume not in (None, 0) and current_volume is not None:
            volume_diff_pct = ((current_volume - previous_volume) / previous_volume) * 100
            has_volume = True
        else:
            volume_diff_pct = None

        price_change_pct = ((current_close - previous_close) / previous_close) * 100
        volume_surged = volume_diff_pct is not None and volume_diff_pct >= VOLUME_THRESHOLD_PCT

        signal = None
        if volume_surged and price_change_pct > PRICE_THRESHOLD_PCT:
            signal = "AC"
            ac_count += 1
        elif volume_surged and price_change_pct < -PRICE_THRESHOLD_PCT:
            signal = "DD"
            dd_count += 1

        if not signal:
            continue

        vwap = current.get("vwap")
        if vwap is None:
            vwap_yn = "N/A"
        else:
            vwap_yn = "Y" if current_close > vwap else "N"

        rows.append({
            "signal": signal,
            "time": current["time"],
            "previousTime": previous["time"],
            "symbol": current["symbol"],
            "strike": current["strike"],
            "instrumentType": current["instrumentType"],
            "indexLevel": current_close,
            "previousIndexLevel": previous_close,
            "priceChangePct": price_change_pct,
            "intervalVolume": current_volume,
            "previousIntervalVolume": previous_volume,
            "vwapYN": vwap_yn,
            "volumeDiffPct": volume_diff_pct,
        })

    return {
        "rows": rows,
        "acCount": ac_count,
        "ddCount": dd_count,
        "hasVolume": has_volume,
    }


def _combine_analyses(analyses):
    combined = {"rows": [], "acCount": 0, "ddCount": 0, "hasVolume": False}
    for analysis in analyses:
        combined["rows"].extend(analysis["rows"])
        combined["acCount"] += analysis["acCount"]
        combined["ddCount"] += analysis["ddCount"]
        combined["hasVolume"] = combined["hasVolume"] or analysis["hasVolume"]
    return combined


def _empty_index_result():
    empty_side = {"rows": [], "acCount": 0, "ddCount": 0, "hasVolume": False}
    return {"strike": None, "hasOptionData": False, "ce": empty_side, "pe": empty_side}


def _load_today_option_points(contract_month):
    start, end = _today_bounds()
    future_levels = _load_future_levels(contract_month, start, end)
    queryset = MarketSnapshot.objects.filter(
        bucket_time__gte=start,
        bucket_time__lt=end,
        contract_month=contract_month,
        instrument_type__in=OPTION_TYPES,
        strike__isnull=False,
    ).order_by("bucket_time", "symbol")

    points_by_index = {key: [] for key in CONTRACT_NAMES.keys()}
    for snapshot in queryset:
        if snapshot.index_key not in points_by_index:
            continue
        if not _is_market_time(_to_market_aware(snapshot.bucket_time)):
            continue
        if not _is_near_atm(snapshot, future_levels):
            continue
        points_by_index[snapshot.index_key].append(_snapshot_to_point(snapshot))

    return points_by_index


def compute_signals(contract_month, timeframe_minutes_list):
    """Compute AC/DD signals for the given contract month at each requested
    timeframe. Returns ``{ "byTimeframe": { "5": {nifty: ..., ...}, "15": ... } }``.

    Each index entry mirrors the previous frontend shape so the dashboard
    panel can render without recomputing:
        {strike, hasOptionData, ce: {rows, acCount, ddCount, hasVolume}, pe: {...}}
    """
    points_by_index = _load_today_option_points(contract_month)

    by_timeframe = {}
    for tf in timeframe_minutes_list:
        per_index = {}
        for key in CONTRACT_NAMES.keys():
            points = points_by_index.get(key, [])
            if not points:
                per_index[key] = _empty_index_result()
                continue

            ce_points = [p for p in points if p["instrumentType"] == "CE"]
            pe_points = [p for p in points if p["instrumentType"] == "PE"]

            ce_analyses = [
                _analyze_group(_aggregate_to_timeframe(group, tf), tf)
                for group in _group_by_symbol(ce_points)
            ]
            pe_analyses = [
                _analyze_group(_aggregate_to_timeframe(group, tf), tf)
                for group in _group_by_symbol(pe_points)
            ]

            latest_strike = max(points, key=lambda p: p["time"])["strike"]

            per_index[key] = {
                "strike": latest_strike,
                "hasOptionData": True,
                "ce": _combine_analyses(ce_analyses),
                "pe": _combine_analyses(pe_analyses),
            }

        by_timeframe[str(tf)] = per_index

    return {"byTimeframe": by_timeframe}

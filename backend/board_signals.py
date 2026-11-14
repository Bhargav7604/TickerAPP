"""Indicators for the intraday scanner and the sector smart-money table, computed from minute bars."""
import math

SESSION_MINUTES = 375  # 09:15 to 15:30
ORB_MINUTES = 15
INDICATORS = ("vwap", "ema", "st", "rsi", "macd", "orb", "cpr", "pdhl", "vol", "oi", "rs", "dr", "sec")
CORE = ("vwap", "st", "ema")


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def pct(value, base):
    return (value - base) / base * 100 if finite(value) and finite(base) and base else None


def ema(values, n):
    """Exponential average seeded with the simple average of the first n values; None before that."""
    if len(values) < n:
        return []
    k = 2 / (n + 1)
    current = sum(values[:n]) / n
    out = [None] * (n - 1) + [current]
    for value in values[n:]:
        current = value * k + current * (1 - k)
        out.append(current)
    return out


def rsi(closes, n=14):
    """Wilder's RSI of the last close."""
    if len(closes) < n + 1:
        return None
    gain = loss = 0.0
    for i in range(1, n + 1):
        change = closes[i] - closes[i - 1]
        gain += max(change, 0)
        loss += max(-change, 0)
    gain, loss = gain / n, loss / n
    for i in range(n + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        gain = (gain * (n - 1) + max(change, 0)) / n
        loss = (loss * (n - 1) + max(-change, 0)) / n
    return 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)


def supertrend(bars, n=10, multiplier=3):
    """bars: [[open, high, low, close], ...]. Returns (direction 1/-1, stop line, ATR) or None."""
    if len(bars) < n + 1:
        return None

    def true_range(i):
        return max(bars[i][1] - bars[i][2], abs(bars[i][1] - bars[i - 1][3]), abs(bars[i][2] - bars[i - 1][3]))

    atr = sum(true_range(i) for i in range(1, n + 1)) / n
    upper = lower = line = None
    direction = 1
    for i in range(n, len(bars)):
        if i > n:
            atr = (atr * (n - 1) + true_range(i)) / n
        middle = (bars[i][1] + bars[i][2]) / 2
        band_up, band_down = middle + multiplier * atr, middle - multiplier * atr
        upper = band_up if upper is None or band_up < upper or bars[i - 1][3] > upper else upper
        lower = band_down if lower is None or band_down > lower or bars[i - 1][3] < lower else lower
        if direction == 1 and bars[i][3] < lower:
            direction = -1
        elif direction == -1 and bars[i][3] > upper:
            direction = 1
        line = lower if direction == 1 else upper
    return direction, line, atr


def macd_histogram(closes):
    slow = ema(closes, 26)
    if len(slow) < 35:
        return None
    fast = ema(closes, 12)
    line = [f - s for f, s in zip(fast, slow) if f is not None and s is not None]
    signal = ema(line, 9)
    return line[-1] - signal[-1] if signal else None


def group_bars(minute_bars, size):
    """minute_bars: [(minute, open, high, low, close, volume, flow)] in order -> [[open, high, low, close]] of `size` minutes."""
    groups = {}
    for minute, o, h, l, c, *_ in minute_bars:
        key = minute // size
        bar = groups.get(key)
        if bar is None:
            groups[key] = [o, h, l, c]
        else:
            bar[1], bar[2], bar[3] = max(bar[1], h), min(bar[2], l), c
    return [groups[key] for key in sorted(groups)]


def buildup(change_pct, oi_change_pct):
    if not finite(change_pct) or not finite(oi_change_pct):
        return None
    if change_pct >= 0:
        return "LB" if oi_change_pct >= 0 else "SC"
    return "SB" if oi_change_pct >= 0 else "LU"


def sector_flow(stocks):
    """stocks: dicts with sector, ltp, prev, vwap, flow, flow30, value, oi, prevOi. Returns sector rows, best score first.

    Delivery data is not available from Zerodha, so the smart-money verdict rests on flow, VWAP and futures build-up.
    """
    sectors = {}
    for stock in stocks:
        change = pct(stock.get("ltp"), stock.get("prev"))
        if change is None:
            continue
        row = sectors.setdefault(stock["sector"], {"sector": stock["sector"], "count": 0, "flow": 0.0, "flow30": 0.0, "value": 0.0,
                                                    "vwapSeen": 0, "aboveVwap": 0, "fno": 0, "lb": 0, "sb": 0, "sc": 0, "lu": 0,
                                                    "up": 0, "down": 0, "best": None, "worst": None})
        row["count"] += 1
        row["flow"] += (stock.get("flow") or 0) / 1e7
        row["flow30"] += (stock.get("flow30") or 0) / 1e7
        row["value"] += (stock.get("value") or 0) / 1e7
        if finite(stock.get("vwap")):
            row["vwapSeen"] += 1
            row["aboveVwap"] += stock["ltp"] > stock["vwap"]
        build = buildup(change, pct(stock.get("oi"), stock.get("prevOi")))
        if build:
            row["fno"] += 1
            row[build.lower()] += 1
        row["up"] += change > 0.1
        row["down"] += change < -0.1
        if row["best"] is None or change > row["best"][1]:
            row["best"] = (stock["symbol"], round(change, 2))
        if row["worst"] is None or change < row["worst"][1]:
            row["worst"] = (stock["symbol"], round(change, 2))
    rows = list(sectors.values())
    top_flow = max([abs(row["flow"]) for row in rows] + [1e-9])
    top_flow30 = max([abs(row["flow30"]) for row in rows] + [1e-9])
    for row in rows:
        above = row["aboveVwap"] / row["vwapSeen"] if row["vwapSeen"] else 0.5
        oi_balance = (row["lb"] - row["sb"]) / row["fno"] if row["fno"] else 0
        # The file's weights without the delivery term, rescaled to the same 100-point range.
        score = (35 * row["flow"] / top_flow + 20 * row["flow30"] / top_flow30 + 40 * (above - 0.5) + 15 * oi_balance) / 0.9
        row["aboveVwapPct"] = round(above * 100)
        row["score"] = round(score, 1)
        row["tag"] = ("in" if score >= 35 else "acc" if score >= 15 else "out" if score <= -35 else "dis" if score <= -15 else "neu")
        for key in ("flow", "flow30", "value"):
            row[key] = round(row[key], 2)
    return sorted(rows, key=lambda row: -row["score"])


def indicators(stock, minute_bars, size, now_minute, nifty_change, sector_tags):
    """The 13 checks for one stock on `size`-minute bars. Each value is [side, detail...]; missing data is left out."""
    out = {}
    ltp, prev = stock["ltp"], stock.get("prev")
    change = pct(ltp, prev)
    bars = group_bars(minute_bars, size)
    closes = [bar[3] for bar in bars]
    vwap = stock.get("vwap")
    if finite(vwap) and vwap:
        distance = (ltp - vwap) / vwap * 100
        out["vwap"] = [1 if distance > 0.05 else -1 if distance < -0.05 else 0, round(distance, 2)]
    fast, slow = ema(closes, 9), ema(closes, 21)
    if slow and slow[-1] is not None:
        out["ema"] = [1 if fast[-1] > slow[-1] else -1]
    trend = supertrend(bars)
    if trend:
        out["st"] = [trend[0], round(trend[1], 2)]
    strength = rsi(closes)
    if strength is not None:
        out["rsi"] = [1 if strength > 55 else -1 if strength < 45 else 0, round(strength, 1)]
    histogram = macd_histogram(closes)
    if histogram is not None:
        out["macd"] = [1 if histogram > 0 else -1, round(histogram, 3)]
    opening = [bar for bar in minute_bars if bar[0] < ORB_MINUTES]
    if now_minute >= ORB_MINUTES and opening:
        high, low = max(bar[2] for bar in opening), min(bar[3] for bar in opening)
        out["orb"] = [1 if ltp > high else -1 if ltp < low else 0, round(high, 2), round(low, 2)]
    prev_high, prev_low = stock.get("prevH"), stock.get("prevL")
    if finite(prev_high) and finite(prev_low) and finite(prev):
        pivot = (prev_high + prev_low + prev) / 3
        bottom = (prev_high + prev_low) / 2
        top = 2 * pivot - bottom
        cpr_high, cpr_low = max(top, bottom), min(top, bottom)
        out["cpr"] = [1 if ltp > cpr_high else -1 if ltp < cpr_low else 0, round(cpr_low, 2), round(cpr_high, 2)]
        out["pdhl"] = [1 if ltp > prev_high else -1 if ltp < prev_low else 0, prev_high, prev_low]
    avg_volume, volume = stock.get("avgVol"), stock.get("volume")
    if finite(avg_volume) and avg_volume and finite(volume) and change is not None:
        elapsed = min(max(now_minute + 1, 1), SESSION_MINUTES) / SESSION_MINUTES
        pace = volume / (avg_volume * elapsed)
        out["vol"] = [(1 if change >= 0 else -1) if pace >= 1.5 else 0, round(pace, 2)]
    oi_change = pct(stock.get("oi"), stock.get("prevOi"))
    build = buildup(change, oi_change)
    if build:
        out["oi"] = [1 if build == "LB" else -1 if build == "SB" else 0, build, round(oi_change, 2)]
    if change is not None and finite(nifty_change):
        relative = change - nifty_change
        out["rs"] = [1 if relative > 0.3 else -1 if relative < -0.3 else 0, round(relative, 2)]
    high, low = stock.get("high"), stock.get("low")
    if finite(high) and finite(low) and high > low:
        position = (ltp - low) / (high - low)
        out["dr"] = [1 if position >= 0.75 else -1 if position <= 0.25 else 0, round(position * 100)]
    tag = sector_tags.get(stock.get("sector"))
    if tag:
        out["sec"] = [1 if tag[1] >= 15 else -1 if tag[1] <= -15 else 0, tag[0]]
    return out, trend


def trade_plan(ltp, checks, trend):
    """Bias, stop and a 1:2 target in the file's rules: stop at Supertrend or VWAP, kept between 0.3% and 2% away."""
    bull = sum(1 for value in checks.values() if value[0] > 0)
    bear = sum(1 for value in checks.values() if value[0] < 0)
    side = 1 if bull > bear else -1 if bear > bull else 0
    stop = target = None
    vwap = None
    if "vwap" in checks:
        vwap = ltp / (1 + checks["vwap"][1] / 100)
    atr = trend[2] if trend else ltp * 0.004
    if side > 0:
        options = [value for value in (trend[1] if trend and trend[0] > 0 else None, vwap if vwap and vwap < ltp else None) if value]
        stop = max(options) if options else ltp - 1.5 * atr
        stop = min(max(stop, ltp * 0.98), ltp * 0.997)
    elif side < 0:
        options = [value for value in (trend[1] if trend and trend[0] < 0 else None, vwap if vwap and vwap > ltp else None) if value]
        stop = min(options) if options else ltp + 1.5 * atr
        stop = max(min(stop, ltp * 1.02), ltp * 1.003)
    if stop is not None:
        target = ltp + 2 * (ltp - stop)
    return {"bull": bull, "bear": bear, "avail": len(checks), "side": side,
            "stop": round(stop, 2) if stop is not None else None, "target": round(target, 2) if target is not None else None}

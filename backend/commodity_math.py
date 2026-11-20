"""The maths behind the commodity insights: volatility, expected range, trend, term structure, rollover and ratios.

All inputs are plain numbers or daily candles [date, open, high, low, close, volume] oldest first, so each
function can be checked by hand. Daily history is Zerodha's continuous futures series (expired contracts
stitched together), so averages and volatility do not break at each expiry.
"""
import math

TRADING_DAYS = 252
# Rupees gained or lost per 1-point move for one lot, from the MCX contract specifications.
# Gold is quoted per 10 g with a 1 kg lot (x100); silver per kg with a 30 kg lot; base metals per kg.
LOT_MULTIPLIER = {"CRUDEOIL": 100, "NATURALGAS": 1250, "GOLD": 100, "SILVER": 30, "COPPER": 2500, "ZINC": 5000}
LOT_TEXT = {"CRUDEOIL": "100 barrels", "NATURALGAS": "1,250 mmBtu", "GOLD": "1 kg", "SILVER": "30 kg", "COPPER": "2,500 kg", "ZINC": "5 tonnes"}


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def rounded(value, places=2):
    return round(value, places) if finite(value) else None


def closes_of(candles):
    return [row[4] for row in candles if finite(row[4]) and row[4] > 0]


def daily_volatility(candles, sessions=20):
    """Standard deviation of daily log returns over the last `sessions` sessions (a fraction, e.g. 0.018)."""
    closes = closes_of(candles)[-(sessions + 1):]
    if len(closes) < 6:
        return None
    returns = [math.log(b / a) for a, b in zip(closes, closes[1:])]
    mean = sum(returns) / len(returns)
    return math.sqrt(sum((value - mean) ** 2 for value in returns) / (len(returns) - 1))


def average_true_range(candles, sessions=14):
    rows = [row for row in candles if all(finite(value) for value in row[2:5])][-(sessions + 1):]
    if len(rows) < 2:
        return None
    ranges = [max(row[2] - row[3], abs(row[2] - before[4]), abs(row[3] - before[4])) for before, row in zip(rows, rows[1:])]
    return sum(ranges) / len(ranges)


def moving_average(candles, sessions):
    closes = closes_of(candles)
    return sum(closes[-sessions:]) / sessions if len(closes) >= sessions else None


def pivots(candle):
    """Classic floor pivots from one session's high, low and close."""
    if not candle:
        return None
    high, low, close = candle[2], candle[3], candle[4]
    pivot = (high + low + close) / 3
    return {"P": pivot, "R1": 2 * pivot - low, "S1": 2 * pivot - high, "R2": pivot + (high - low), "S2": pivot - (high - low)}


def expected_range(label, prev_close, sigma, spot, levels):
    """About a 2-in-3 chance of today's price staying within one day's volatility of yesterday's close."""
    if not finite(prev_close) or not finite(sigma) or not finite(spot):
        return None
    low, high = prev_close * math.exp(-sigma), prev_close * math.exp(sigma)
    places = 2 if prev_close < 1000 else 0
    fmt = (lambda value: f"{value:,.2f}") if places else (lambda value: f"{value:,.0f}")
    return {"low": round(low, places), "high": round(high, places), "spot": spot, "basis": "realized",
            "iv": round(sigma * math.sqrt(TRADING_DAYS) * 100, 1),
            "support": rounded(levels["S1"]) if levels else None, "resistance": rounded(levels["R1"]) if levels else None,
            "text": f"{label} will most likely stay between {fmt(low)} and {fmt(high)} today (about a 2 in 3 chance), "
                    f"going by how much it moved in the last 20 sessions."}


def trend(candles, ltp):
    sma20, sma50 = moving_average(candles, 20), moving_average(candles, 50)
    closes = closes_of(candles)
    year = [row for row in candles[-TRADING_DAYS:] if finite(row[2]) and finite(row[3])]
    high52 = max((row[2] for row in year), default=None)
    low52 = min((row[3] for row in year), default=None)
    change5 = (ltp / closes[-5] - 1) * 100 if finite(ltp) and len(closes) >= 5 else None
    above = [finite(average) and ltp > average for average in (sma20, sma50)] if finite(ltp) else [False, False]
    if finite(ltp) and finite(sma20) and finite(sma50):
        read = ("Uptrend: above its 20 and 50-day averages." if all(above) else "Downtrend: below its 20 and 50-day averages." if not any(above)
                else "Mixed: between its 20 and 50-day averages.")
    else:
        read = "Not enough history for a trend yet."
    return {"sma20": rounded(sma20), "sma50": rounded(sma50), "aboveSma20": above[0], "aboveSma50": above[1], "change5dPct": rounded(change5),
            "high52": high52, "low52": low52, "fromHighPct": rounded((ltp / high52 - 1) * 100) if finite(ltp) and high52 else None,
            "fromLowPct": rounded((ltp / low52 - 1) * 100) if finite(ltp) and low52 else None, "read": read}


def volatility(candles, high, low, ltp):
    sigma = daily_volatility(candles)
    atr = average_true_range(candles)
    today = high - low if finite(high) and finite(low) else None
    used = today / atr * 100 if finite(today) and finite(atr) and atr else None
    if used is None:
        read = "Today's range shows once trading starts."
    elif used >= 100:
        read = f"Already moved {used:.0f}% of a normal day's range: big day, late entries are risky."
    elif used >= 70:
        read = f"Used {used:.0f}% of a normal day's range: little room left today."
    else:
        read = f"Used {used:.0f}% of a normal day's range: room for a bigger move."
    return {"dailyVolPct": rounded(sigma * 100 if sigma else None), "annualVolPct": rounded(sigma * math.sqrt(TRADING_DAYS) * 100 if sigma else None, 1),
            "atr": rounded(atr), "atrPct": rounded(atr / ltp * 100 if finite(atr) and finite(ltp) and ltp else None),
            "todayRange": rounded(today), "rangeUsedPct": rounded(used, 0), "read": read}, sigma


def term_structure(current, upcoming, far, days_current, days_next):
    """Next minus current month: positive is contango (normal carry), negative is backwardation (tight supply now)."""
    if not finite(current) or not finite(upcoming) or not current:
        return {"spread": None, "spreadPct": None, "carryAnnualPct": None, "state": None, "farSpread": None,
                "read": "Needs prices for two contract months."}
    spread = upcoming - current
    pct = spread / current * 100
    gap = (days_next or 0) - (days_current or 0)
    carry = pct * 365 / gap if gap > 0 else None
    state = "contango" if spread > 0 else "backwardation" if spread < 0 else "flat"
    read = {"contango": "Contango: later months cost more, the normal state when supply is comfortable.",
            "backwardation": "Backwardation: the near month costs more, a sign of tight supply right now.",
            "flat": "Flat: both months trade at the same price."}[state]
    return {"spread": rounded(spread), "spreadPct": rounded(pct), "carryAnnualPct": rounded(carry, 1), "state": state,
            "farSpread": rounded(far - current) if finite(far) else None, "read": read}


def rollover(oi_current, oi_next, oi_far, days_to_expiry):
    total = sum(value for value in (oi_current, oi_next, oi_far) if finite(value))
    if not total:
        return {"rolloverPct": None, "read": "Open interest not available yet."}
    moved = sum(value for value in (oi_next, oi_far) if finite(value)) / total * 100
    if finite(days_to_expiry) and days_to_expiry <= 5:
        read = f"Expiry in {days_to_expiry} days: {moved:.0f}% of open interest has moved to later months."
    else:
        read = f"{moved:.0f}% of open interest sits in later months; most positions are still in the current month." if moved < 50 \
            else f"{moved:.0f}% of open interest already sits in later months."
    return {"rolloverPct": rounded(moved, 1), "read": read}


def per_lot(name, ltp, change, atr):
    multiplier = LOT_MULTIPLIER.get(name)
    if not multiplier:
        return None
    return {"lot": LOT_TEXT[name], "perPoint": multiplier, "contractValue": round(ltp * multiplier) if finite(ltp) else None,
            "todayPerLot": round(change * multiplier) if finite(change) else None, "atrPerLot": round(atr * multiplier) if finite(atr) else None}


def gold_silver_ratio(gold_10g, silver_kg, gold_history, silver_history, sessions=20):
    """Kilograms of silver one kilogram of gold buys; above its average, silver is cheap against gold."""
    if not finite(gold_10g) or not finite(silver_kg) or not silver_kg:
        return None
    ratio = gold_10g * 100 / silver_kg
    silver_by_day = {row[0]: row[4] for row in silver_history}
    past = [row[4] * 100 / silver_by_day[row[0]] for row in gold_history if row[0] in silver_by_day and silver_by_day[row[0]]][-sessions:]
    average = sum(past) / len(past) if past else None
    if average is None:
        read = "Not enough history for an average yet."
    elif ratio > average * 1.02:
        read = "Above its 20-day average: silver is cheap against gold (gold is leading)."
    elif ratio < average * 0.98:
        read = "Below its 20-day average: silver is outperforming gold (often risk-on)."
    else:
        read = "Close to its 20-day average: gold and silver are moving together."
    return {"ratio": round(ratio, 2), "average20": rounded(average), "read": read}


def relative_strength(first_pct, second_pct, first, second, meaning_up, meaning_down):
    if not finite(first_pct) or not finite(second_pct):
        return None
    gap = first_pct - second_pct
    read = (f"{first} beating {second} by {gap:.2f}% today: {meaning_up}" if gap > 0.25
            else f"{first} lagging {second} by {abs(gap):.2f}% today: {meaning_down}" if gap < -0.25
            else f"{first} and {second} moving together today.")
    return {"firstPct": rounded(first_pct), "secondPct": rounded(second_pct), "gap": rounded(gap), "read": read}


def rupee_effect(ltp, change_pct):
    if not finite(ltp) or not finite(change_pct):
        return None
    direction = "weaker" if change_pct > 0 else "stronger" if change_pct < 0 else "unchanged"
    read = (f"Rupee {direction} by {abs(change_pct):.2f}%: MCX prices are in rupees, so this alone moves gold, silver and crude "
            f"about {abs(change_pct):.2f}% {'up' if change_pct > 0 else 'down'}." if direction != "unchanged" else "Rupee unchanged: no currency effect today.")
    return {"ltp": ltp, "changePct": rounded(change_pct), "read": read}

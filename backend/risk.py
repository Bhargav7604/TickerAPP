"""Money guard and option risk checks: position size, what-if, break-even odds, profit protection,
option-seller alarm, stock-expiry delivery warning, option cost level and expected expiry close.

All amounts are rupees. These describe risk; they never tell anyone to buy or sell.
"""
import math

from .oi_analysis import RISK_FREE_RATE, _cdf, option_price

DEFAULT_FUTURES_STOP_PCT = 0.5
DEFAULT_OPTION_BUY_STOP_PCT = 30
DEFAULT_OPTION_SELL_STOP_PCT = 50
PROFIT_KEEP_FRACTION = 2 / 3
NEWS_IV_DROP = 0.2
SELLER_SHOCK_PCT = 1.0
ESTIMATED_MARGIN_PCT = 12
DELIVERY_WARNING_DAYS = 3


def rupees(value):
    return f"₹{abs(value):,.0f}"


def default_stop(side, entry, instrument):
    if instrument == "FUT":
        move = entry * DEFAULT_FUTURES_STOP_PCT / 100
        return round(entry - move if side == "buy" else entry + move, 2)
    pct = DEFAULT_OPTION_BUY_STOP_PCT if side == "buy" else -DEFAULT_OPTION_SELL_STOP_PCT
    return round(entry * (1 - pct / 100), 2)


def position_size(capital, risk_pct, entry, stop, lot_size, licence_level=2, lots_wanted=None):
    """Lots that keep the loss at the stop within risk_pct of capital, with warnings for anything bigger."""
    budget = capital * risk_pct / 100
    per_lot = abs(entry - stop) * lot_size
    if capital <= 0 or per_lot <= 0:
        return {"lots": 0, "riskPerLot": round(per_lot), "budget": round(budget), "maxLoss": 0,
                "text": "Enter your trading money and a stop level to see a safe size."}
    lots = math.floor(budget / per_lot)
    if licence_level == 1:
        lots = min(lots, 1)
    result = {"lots": lots, "riskPerLot": round(per_lot), "budget": round(budget), "maxLoss": round(lots * per_lot)}
    if lots == 0:
        result["text"] = f"Even one lot risks {rupees(per_lot)}, more than your {rupees(budget)} limit per trade. Better to skip or use a closer stop."
    else:
        result["text"] = f"Up to {lots} lot{'s' if lots != 1 else ''}. If the stop is hit you lose about {rupees(lots * per_lot)} ({risk_pct:g}% of your money)."
    if lots_wanted:
        loss = lots_wanted * per_lot
        result["wantedLoss"] = round(loss)
        if lots_wanted > lots:
            result["warning"] = f"{lots_wanted} lots could lose {rupees(loss)}, which is {loss / capital * 100:.1f}% of your money. That is too much risk."
    return result


def _reprice(spot, strike, years, iv, option_type, move_pct=0.0, iv_factor=1.0):
    return option_price(spot * (1 + move_pct / 100), strike, years, max(iv * iv_factor, 0.01) / 100, option_type)


def what_if(trade, spot=None, years=None, iv=None):
    """Rupee result of small market moves and of option prices falling after news.

    Option scenarios are measured from the option's current model value, so they show only
    the effect of the move or the IV drop, not any gap between the entry price and fair value.
    """
    sign = 1 if trade["side"] == "buy" else -1
    quantity = trade["lots"] * trade["lot_size"]
    option = trade["instrument"] in ("CE", "PE") and spot and years and iv
    base = _reprice(spot, trade["strike"], years, iv, trade["instrument"]) if option else None
    scenarios = []
    for move in (-1.0, -0.5, 0.5, 1.0):
        label = f"If the market {'falls' if move < 0 else 'rises'} {abs(move):g}%"
        if trade["instrument"] == "FUT":
            change = trade["entry"] * move / 100
        elif option:
            change = _reprice(spot, trade["strike"], years, iv, trade["instrument"], move) - base
        else:
            continue
        scenarios.append({"label": label, "pnl": round(change * sign * quantity)})
    if option:
        change = _reprice(spot, trade["strike"], years, iv, trade["instrument"], iv_factor=1 - NEWS_IV_DROP) - base
        scenarios.append({"label": "If option prices drop after the news", "pnl": round(change * sign * quantity)})
    for scenario in scenarios:
        scenario["text"] = f"{scenario['label']}, you {'gain' if scenario['pnl'] >= 0 else 'lose'} {rupees(scenario['pnl'])}."
    return scenarios


def break_even_odds(spot, strike, premium, option_type, years, iv, label="The index", when="expiry"):
    """How far the index must move by expiry for a bought option to make money, and the chance of that."""
    if not all((spot, strike, premium, years, iv)) or years <= 0:
        return None
    breakeven = strike + premium if option_type == "CE" else strike - premium
    need = breakeven - spot if option_type == "CE" else spot - breakeven
    vol = iv / 100
    d2 = (math.log(spot / breakeven) + (RISK_FREE_RATE - vol * vol / 2) * years) / (vol * math.sqrt(years))
    chance = (_cdf(d2) if option_type == "CE" else _cdf(-d2)) * 100
    verdict = "That looks unlikely." if chance < 25 else "Possible, but less than an even chance." if chance < 50 else "That looks likely."
    if need <= 0:
        text = f"{label} is already past the break-even level of {breakeven:,.0f}. Chance it stays there until {when}: about {chance:.0f}%."
    else:
        text = (f"{label} must {'rise' if option_type == 'CE' else 'fall'} {need:,.0f} points ({need / spot * 100:.1f}%) "
                f"before {when} to make money. Chance about {chance:.0f}%. {verdict}")
    return {"breakeven": round(breakeven, 2), "pointsNeeded": round(max(need, 0), 2), "chance": round(chance, 1), "text": text}


def protect_profit(side, entry, current, lots, lot_size):
    sign = 1 if side == "buy" else -1
    open_pnl = (current - entry) * sign * lots * lot_size
    if open_pnl <= 0:
        return None
    level = entry + (current - entry) * PROFIT_KEEP_FRACTION
    kept = open_pnl * PROFIT_KEEP_FRACTION
    return {"openPnl": round(open_pnl), "exitLevel": round(level, 2), "keeps": round(kept),
            "text": f"You are up {rupees(open_pnl)}. An exit at {level:,.2f} would keep at least {rupees(kept)}."}


def seller_alarm(spot, strike, option_type, premium, lots, lot_size, years, iv, label="the market", margin=None):
    quantity = lots * lot_size
    shock = SELLER_SHOCK_PCT if option_type == "CE" else -SELLER_SHOCK_PCT
    loss = (_reprice(spot, strike, years, iv, option_type, shock) - premium) * quantity if years and iv else None
    estimated = False
    if margin is None:
        margin, estimated = spot * quantity * ESTIMATED_MARGIN_PCT / 100, True
    move = "jumps" if option_type == "CE" else "falls"
    text = (f"If {label} {move} 1%, you could lose about {rupees(loss)}. " if loss and loss > 0 else "") + \
        "When you sell an option, your loss has no upper limit. " + \
        f"Margin needed: about {rupees(margin)}{' (estimate; your broker shows the exact amount)' if estimated else ''}."
    return {"lossOnShock": round(loss) if loss else None, "margin": round(margin), "marginEstimated": estimated, "text": text}


def stock_expiry_warning(trade, price, today):
    """Stock F&O is settled by delivery: warn when a position is close to expiry."""
    expiry = trade.get("expiry")
    if trade.get("index_key") or not expiry:
        return None
    days = (expiry - today).days
    if days < 0 or days > DELIVERY_WARNING_DAYS:
        return None
    quantity = trade["lots"] * trade["lot_size"]
    instrument, side, strike = trade["instrument"], trade["side"], trade.get("strike")
    if instrument == "FUT":
        need = "buy" if side == "buy" else "deliver"
        amount = price * quantity
    elif (instrument == "CE") == (side == "buy"):
        in_money = price > strike if instrument == "CE" else price < strike
        if not in_money:
            return None
        need, amount = ("buy", strike * quantity) if instrument == "CE" else ("deliver", strike * quantity)
    else:
        in_money = price > strike if instrument == "CE" else price < strike
        if not in_money:
            return None
        need, amount = ("deliver", strike * quantity) if instrument == "CE" else ("buy", strike * quantity)
    when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
    action = "buy the shares" if need == "buy" else "hand over the shares"
    return {"days": days, "amount": round(amount),
            "text": f"{trade['symbol']} expires {when}. At expiry you may have to actually {action}. "
                    f"Close this before expiry or keep {rupees(amount)} ready."}


def option_cost(vix):
    if vix is None:
        return None
    if vix >= 18:
        return {"level": "costly", "vix": vix, "text": f"Options are costly today (India VIX {vix:.1f}) because the market is nervous. Buyers are paying extra."}
    if vix <= 12:
        return {"level": "cheap", "vix": vix, "text": f"Options are cheap today (India VIX {vix:.1f}). The market is calm, so sellers earn less."}
    return {"level": "normal", "vix": vix, "text": f"Options are normally priced today (India VIX {vix:.1f})."}


def expiry_close_level(rows, spot):
    """Max pain (where option buyers collectively lose the most) and the biggest open-interest walls near the price."""
    rows = [row for row in rows if row.get("call") or row.get("put")]
    if not rows:
        return None

    def payout(level):
        return sum((row["call"]["oi"] if row.get("call") else 0) * max(0, level - row["strike"])
                   + (row["put"]["oi"] if row.get("put") else 0) * max(0, row["strike"] - level) for row in rows)

    pain = min((row["strike"] for row in rows), key=payout)
    walls = sorted(rows, key=lambda row: -((row["call"]["oi"] if row.get("call") else 0) + (row["put"]["oi"] if row.get("put") else 0)))[:2]
    jumps = sorted(row["strike"] for row in walls)
    return {"maxPain": pain, "jumpLevels": jumps,
            "text": f"Based on the biggest option positions, the index is most likely to close near {pain:,.0f} on expiry. "
                    f"Price can move suddenly around {' and '.join(f'{level:,.0f}' for level in jumps)}."}

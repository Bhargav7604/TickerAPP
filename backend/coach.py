"""Discipline tools: pre-trade checklist, learner's licence, self-control coach, personal danger times,
cooling-off, 'if you had followed the plan' lessons, emotion cost, replay of a day and the expiry-day report."""
import datetime as dt
from collections import defaultdict

from .market_contracts import MARKET_TZ
from .models import Alert, CheckIn, MarketSnapshot, OptionOISnapshot, Trade, TraderProfile
from .oi_analysis import trend_payload
from .risk import rupees

TRADES_PER_DAY_LIMIT = 5
LOSSES_BEFORE_BREAK = 2
COOLING_OFF_LOSS_PCT = 2
COOLING_OFF_UNTIL = dt.time(9, 45)
LICENCE_TRADES = 20
LICENCE_DISCIPLINE_PCT = 80
DEMOTE_AFTER_BREAKS = 2
DANGER_MIN_TRADES = 3
DANGER_LOSS_RATE = 60
LEVEL_NAMES = {0: "Learner", 1: "Small", 2: "Standard"}
EMOTION_NAMES = {"fear": "Fear", "greed": "Greed", "anger": "Anger", "revenge": "Trying to win back a loss"}


def profile_for(user):
    return TraderProfile.objects.get_or_create(user=user)[0]


def naive(value):
    """The app stores plain IST clock times (USE_TZ is off); convert aware values to that form."""
    return value.astimezone(MARKET_TZ).replace(tzinfo=None) if value.tzinfo else value


def ist(value):
    return naive(value)


def epoch_of(value):
    return int((value if value.tzinfo else value.replace(tzinfo=MARKET_TZ)).timestamp())


def trades_on(user, day, practice=None):
    start = dt.datetime.combine(day, dt.time.min)
    trades = Trade.objects.filter(user=user, opened_at__gte=start, opened_at__lt=start + dt.timedelta(days=1))
    return trades if practice is None else trades.filter(practice=practice)


def closed(trades):
    return [trade for trade in trades if trade.exit is not None]


def month_real_pnl(user, now):
    start = naive(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return sum(trade.pnl for trade in closed(Trade.objects.filter(user=user, practice=False, opened_at__gte=start)))


def beyond_stop(trade):
    if trade.stop is None or trade.exit is None:
        return False
    return trade.exit < trade.stop - 1e-9 if trade.side == "buy" else trade.exit > trade.stop + 1e-9


def followed_plan(trade):
    return bool(trade.checklist_ready and trade.light_at_entry in ("green", "yellow") and trade.stop is not None and not beyond_stop(trade))


def discipline(trades):
    trades = closed(trades)
    if not trades:
        return 0, 0
    return len(trades), round(sum(followed_plan(trade) for trade in trades) / len(trades) * 100)


def licence(user, profile, now):
    practice_count, practice_pct = discipline(Trade.objects.filter(user=user, practice=True))
    real_count, real_pct = discipline(Trade.objects.filter(user=user, practice=False))
    level = 0
    if practice_count >= LICENCE_TRADES and practice_pct >= LICENCE_DISCIPLINE_PCT:
        level = 1
        if real_count >= LICENCE_TRADES and real_pct >= LICENCE_DISCIPLINE_PCT:
            level = 2
    breaks = sum(not followed_plan(trade) for trade in closed(Trade.objects.filter(user=user, opened_at__gte=naive(now) - dt.timedelta(days=7))))
    if breaks >= DEMOTE_AFTER_BREAKS:
        level = max(0, level - 1)
    if profile.licence_level != level:
        profile.licence_level = level
        profile.save(update_fields=["licence_level"])
    if level == 0:
        progress = (f"{min(practice_count, LICENCE_TRADES)} of {LICENCE_TRADES} practice trades done; "
                    f"you followed the plan in {practice_pct}% (need {LICENCE_DISCIPLINE_PCT}%).")
    elif level == 1:
        progress = (f"{min(real_count, LICENCE_TRADES)} of {LICENCE_TRADES} small real trades done; "
                    f"plan followed in {real_pct}% (need {LICENCE_DISCIPLINE_PCT}%).")
    else:
        progress = "Full money guard unlocked. Breaking the rules twice in a week moves you back a level."
    if breaks >= DEMOTE_AFTER_BREAKS:
        progress = f"You broke the plan {breaks} times this week, so you moved back a level. " + progress
    return {"level": level, "name": LEVEL_NAMES[level], "text": progress,
            "realAllowed": level >= 1, "maxLots": 1 if level == 1 else None}


def cooling_off(user, profile, now):
    if profile.capital and profile.monthly_loss_limit and -month_real_pnl(user, now) >= profile.monthly_loss_limit:
        return {"active": True, "allDay": True, "text": "Your monthly loss limit is reached. Real trading is locked until next month; practice only.",
                "lesson": "Big losses usually come from trading after losses. A pause protects the money you still have."}
    if not profile.capital:
        return {"active": False}
    previous = (Trade.objects.filter(user=user, practice=False, opened_at__lt=dt.datetime.combine(now.date(), dt.time.min))
                .order_by("-opened_at").first())
    if not previous:
        return {"active": False}
    day = ist(previous.opened_at).date()
    loss = -sum(trade.pnl for trade in closed(trades_on(user, day, practice=False)))
    if loss >= profile.capital * COOLING_OFF_LOSS_PCT / 100 and now.time() < COOLING_OFF_UNTIL:
        return {"active": True, "allDay": False, "until": COOLING_OFF_UNTIL.strftime("%H:%M"),
                "text": f"Yesterday you lost {rupees(loss)}. The first 30 minutes today are practice only.",
                "lesson": "After a big loss, the mind wants to win it back fast. That is when the next loss happens. "
                          "Start calm, start small, and follow the checklist."}
    return {"active": False}


def mind_status(user, now):
    checkin = CheckIn.objects.filter(user=user, date=now.date()).first()
    losses = sum(1 for trade in closed(trades_on(user, now.date())) if trade.pnl < 0)
    if not checkin:
        return False, "Answer the three quick questions first.", checkin
    if not checkin.slept_well or checkin.upset or checkin.chasing_loss:
        return False, "You are tired, upset or trying to win back a loss. Take a 30-minute break.", checkin
    if losses >= LOSSES_BEFORE_BREAK:
        return False, f"You lost {losses} times today. Take a 30-minute break.", checkin
    return True, "You are calm and rested.", checkin


def checklist(user, profile, card, danger_notes, now, practice):
    color = card["light"]["color"] if card else "grey"
    market_ok = color == "green"
    market_text = "Price direction and big players agree." if market_ok else card["light"]["label"] if card else "No market data."
    news_ok = not danger_notes and not (card and card.get("expiry", {}) and card["expiry"]["isToday"] and now.time() >= dt.time(14, 30))
    news_text = "No big news or expiry danger right now." if news_ok else (f"Big news today: {danger_notes[0]}" if danger_notes else "Last hour of expiry.")
    cool = cooling_off(user, profile, now)
    level = licence(user, profile, now)
    money_ok, money_text = True, "Your money guard is set."
    if not profile.capital:
        money_ok, money_text = False, "Enter your trading money first."
    elif not practice and cool.get("active"):
        money_ok, money_text = False, cool["text"]
    elif not practice and not level["realAllowed"]:
        money_ok, money_text = False, "Learner's licence: real trading unlocks after 20 disciplined practice trades."
    mind_ok, mind_text, _ = mind_status(user, now)
    checks = [{"name": "Market", "ok": market_ok, "text": market_text}, {"name": "News", "ok": news_ok, "text": news_text},
              {"name": "Money", "ok": money_ok, "text": money_text}, {"name": "Mind", "ok": mind_ok, "text": mind_text}]
    ready = all(check["ok"] for check in checks)
    first_problem = next((check for check in checks if not check["ok"]), None)
    verdict = "Ready." if ready else ("Not ready. Take a 30-minute break." if first_problem["name"] == "Mind" else f"Not ready: {first_problem['text']}")
    return {"ready": ready, "verdict": verdict, "checks": checks}


def coach_warnings(user, new, now):
    warnings = []
    today = list(trades_on(user, now.date()))
    open_same = [trade for trade in today if trade.exit is None and trade.symbol == new["symbol"] and trade.side == new["side"]]
    worse = [trade for trade in open_same if (new["entry"] < trade.entry if new["side"] == "buy" else new["entry"] > trade.entry)]
    if worse:
        warnings.append("You're adding money to a losing trade.")
    if not today and new["lots"] > 1:
        warnings.append("Start small. Your first trade of the day is best with one lot.")
    if len(today) >= TRADES_PER_DAY_LIMIT:
        warnings.append("You've done enough trades today. Rest now.")
    if new.get("emotion") in ("revenge", "anger"):
        warnings.append("You are trading to win back a loss or while angry. That is when traders lose the most.")
    return warnings


def bucket_label(when, on_expiry):
    if on_expiry and when.hour >= 14:
        return "expiry day after 2 pm"
    start = when.replace(minute=0)
    end = start + dt.timedelta(hours=1)
    return f"{when:%A}s between {start:%-I}-{end:%-I %p}".replace("AM", "am").replace("PM", "pm")


def danger_times(user, now):
    buckets = defaultdict(list)
    for trade in closed(Trade.objects.filter(user=user)):
        when = ist(trade.opened_at)
        buckets[bucket_label(when, trade.expiry == when.date())].append(trade.pnl)
    risky = []
    for label, results in buckets.items():
        losses = [pnl for pnl in results if pnl < 0]
        if len(results) >= DANGER_MIN_TRADES and len(losses) / len(results) * 100 >= DANGER_LOSS_RATE:
            risky.append({"label": label, "trades": len(results), "lossRate": round(len(losses) / len(results) * 100), "lost": round(-sum(losses))})
    risky.sort(key=lambda item: -item["lost"])
    current = None
    expiring_today = Trade.objects.filter(user=user, expiry=now.date()).exists()
    for item in risky:
        if item["label"] == bucket_label(now, expiring_today):
            current = f"You often lose on {item['label']}. It is {now:%-I:%M %p} now. Be careful.".replace("AM", "am").replace("PM", "pm")
    return {"times": risky, "now": current}


def plan_lessons(user, limit=10):
    lessons = []
    for trade in closed(Trade.objects.filter(user=user))[:200]:
        if trade.pnl >= 0:
            continue
        loss = -trade.pnl
        if trade.light_at_entry == "red":
            saved, why = loss, "The light was red. Waiting would have saved"
        elif not trade.checklist_ready:
            saved, why = loss, "The checklist said Not ready. Skipping this trade would have saved"
        elif beyond_stop(trade):
            planned = abs(trade.entry - trade.stop) * trade.lots * trade.lot_size
            saved, why = max(loss - planned, 0), "Exiting at your stop would have saved"
        else:
            continue
        if saved > 0:
            lessons.append({"tradeId": trade.id, "symbol": trade.symbol, "date": ist(trade.opened_at).date().isoformat(),
                            "lost": round(loss), "saved": round(saved), "text": f"{why} {rupees(saved)}."})
        if len(lessons) >= limit:
            break
    return {"lessons": lessons, "totalSaved": sum(item["saved"] for item in lessons)}


def emotion_cost(user, now):
    start = naive(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cost = defaultdict(float)
    for trade in closed(Trade.objects.filter(user=user, opened_at__gte=start)):
        if trade.pnl < 0 and trade.emotion in EMOTION_NAMES:
            cost[trade.emotion] += -trade.pnl
    parts = [f"{EMOTION_NAMES[key].lower()} cost you {rupees(value)}" for key, value in sorted(cost.items(), key=lambda item: -item[1])]
    return {"byEmotion": {key: round(value) for key, value in cost.items()},
            "text": f"This month, {', '.join(parts)}." if parts else "This month no losses were tagged with fear, greed or anger."}


def futures_day(index_key, day):
    start = dt.datetime.combine(day, dt.time.min)
    return list(MarketSnapshot.objects.filter(index_key=index_key, contract_month="current", instrument_type="FUT",
                                              bucket_time__gte=start, bucket_time__lt=start + dt.timedelta(days=1)).order_by("bucket_time"))


def nearest_expiry_recorded(index_key, day):
    start = dt.datetime.combine(day, dt.time.min)
    return (OptionOISnapshot.objects.filter(index_key=index_key, bucket_time__gte=start, bucket_time__lt=start + dt.timedelta(days=1), expiry__gte=day)
            .order_by("expiry").values_list("expiry", flat=True).first())


def epoch(naive_ist):
    return int(naive_ist.replace(tzinfo=MARKET_TZ).timestamp())


def day_alerts(day, index_key=None):
    start = dt.datetime.combine(day, dt.time.min)
    alerts = Alert.objects.filter(created_at__gte=start, created_at__lt=start + dt.timedelta(days=1)).order_by("created_at")
    return alerts.filter(index_key=index_key) if index_key else alerts


def replay(day):
    indexes = {}
    for key in ("nifty", "banknifty", "sensex"):
        rows = futures_day(key, day)
        expiry = nearest_expiry_recorded(key, day)
        oi = trend_payload(key, expiry, 3, 7, day=day)["series"] if expiry else []
        indexes[key] = {"prices": [{"time": epoch(row.bucket_time.replace(tzinfo=None)), "price": row.index_level, "netLots": row.net_lots} for row in rows],
                        "oi": [{"time": point["time"], "diff": point["diff"], "callOiChange": point["callOiChange"], "putOiChange": point["putOiChange"]} for point in oi]}
    from .alerts import alert_payload
    return {"date": day.isoformat(), "indexes": indexes, "alerts": [alert_payload(alert) for alert in day_alerts(day)]}


def available_days(limit=30):
    days = MarketSnapshot.objects.filter(contract_month="current").dates("bucket_time", "day", order="DESC")[:limit]
    return [day.isoformat() for day in days]


def expiry_report(user, index_key, day):
    rows = futures_day(index_key, day)
    alerts = list(day_alerts(day, index_key))
    trades = [trade for trade in trades_on(user, day) if trade.index_key == index_key]
    result = {"date": day.isoformat(), "index": index_key}
    if rows:
        prices = [row.index_level for row in rows]
        result["market"] = {"open": prices[0], "high": max(prices), "low": min(prices), "close": prices[-1],
                            "text": f"Opened at {prices[0]:,.0f}, moved between {min(prices):,.0f} and {max(prices):,.0f}, closed at {prices[-1]:,.0f}."}
    scored = [alert for alert in alerts if alert.outcome in ("right", "wrong")]
    right = sum(alert.outcome == "right" for alert in scored)
    result["alerts"] = {"count": len(alerts), "right": right, "wrong": len(scored) - right,
                        "text": f"{len(alerts)} alert{'s' if len(alerts) != 1 else ''}; {right} of {len(scored)} checked were right." if alerts else "No alerts that day."}
    done = closed(trades)
    pnl = sum(trade.pnl for trade in done)
    kept = sum(followed_plan(trade) for trade in done)
    result["you"] = {"trades": len(trades), "pnl": round(pnl), "followedPlan": kept,
                     "text": (f"You made {len(trades)} trade{'s' if len(trades) != 1 else ''} and {'made' if pnl >= 0 else 'lost'} {rupees(pnl)}. "
                              f"You followed the plan in {kept} of {len(done)}.") if trades else "You did not trade this index that day."}
    return result


def trade_payload(trade):
    return {"id": trade.id, "openedAt": epoch_of(trade.opened_at), "closedAt": epoch_of(trade.closed_at) if trade.closed_at else None,
            "practice": trade.practice, "index": trade.index_key, "symbol": trade.symbol, "instrument": trade.instrument,
            "strike": trade.strike, "expiry": trade.expiry.isoformat() if trade.expiry else None, "side": trade.side,
            "lots": trade.lots, "lotSize": trade.lot_size, "entry": trade.entry, "stop": trade.stop, "exit": trade.exit,
            "pnl": trade.pnl, "emotion": trade.emotion, "lightAtEntry": trade.light_at_entry,
            "checklistReady": trade.checklist_ready, "followedPlan": followed_plan(trade) if trade.exit is not None else None, "note": trade.note}

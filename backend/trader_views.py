"""Trader desk API: money guard, checklist, journal, coach, alerts report card, replay, expiry report and mentor sharing."""
import datetime as dt
import json
import secrets

from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import coach
from .alerts import alert_payload, report_card, verify_record
from .decision import decision_payload, india_vix
from .equity import broker, catalogue
from .market_contracts import CONTRACT_NAMES, MARKET_TZ, get_master_contract, resolve_contracts
from .models import Alert, CheckIn, MarketNote, Trade, TraderProfile
from .oi_analysis import chain_payload, years_to_expiry
from .risk import (break_even_odds, default_stop, expiry_close_level, option_cost, position_size, protect_profit,
                   seller_alarm, stock_expiry_warning, what_if)
from .views import protected

INSTRUMENTS = ("FUT", "CE", "PE")
SIDES = ("buy", "sell")


def user_or_error(request):
    auth = protected(request)
    return (None, auth) if isinstance(auth, JsonResponse) else (auth[1], None)


def error(message, status=400):
    return JsonResponse({"type": "error", "message": message}, status=status)


def now_ist():
    return dt.datetime.now(MARKET_TZ)


def body(request):
    try:
        return json.loads(request.body or "{}")
    except ValueError:
        raise ValueError("Invalid request.")


def number(data, key, required=False, minimum=None):
    value = data.get(key)
    if value in (None, ""):
        if required:
            raise ValueError(f"{key} is required.")
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a number.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{key} must be at least {minimum:g}.")
    return value


def profile_payload(profile):
    return {"capital": profile.capital, "riskPct": profile.risk_per_trade_pct, "monthlyLossLimit": profile.monthly_loss_limit,
            "practiceMode": profile.practice_mode, "practiceBalance": round(profile.practice_balance, 2),
            "language": profile.language, "telegramLinked": bool(profile.telegram_chat_id), "mentorLink": profile.mentor_token or None}


def card_for(payload, index_key):
    return next((card for card in payload["cards"] if card["key"] == index_key), None)


def contract_row(symbol):
    frame = get_master_contract()
    rows = frame[frame["tradingsymbol"].eq(symbol) & frame["instrument_type"].isin(INSTRUMENTS)]
    return rows.iloc[0] if not rows.empty else None


def describe(data):
    """Validate a proposed trade and fill lot size, symbol and expiry from the instrument catalogue."""
    instrument, side = data.get("instrument", "FUT"), data.get("side", "buy")
    if instrument not in INSTRUMENTS or side not in SIDES:
        raise ValueError("Choose futures, a call or a put, and buy or sell.")
    trade = {"instrument": instrument, "side": side, "lots": int(number(data, "lots", minimum=1) or 1),
             "entry": number(data, "entry", minimum=0.05), "stop": number(data, "stop", minimum=0),
             "strike": number(data, "strike"), "symbol": str(data.get("symbol") or "").strip().upper(),
             "index_key": data.get("index", "") if data.get("index") in CONTRACT_NAMES else "", "emotion": data.get("emotion", "calm")}
    if trade["emotion"] not in dict(Trade.EMOTIONS):
        trade["emotion"] = "calm"
    try:
        trade["expiry"] = dt.date.fromisoformat(data["expiry"]) if data.get("expiry") else None
    except ValueError:
        raise ValueError("Select a valid expiry.")
    if instrument == "FUT" and trade["index_key"] and not trade["symbol"]:
        # Index futures are monthly; the option expiry picked in the form does not apply to them.
        trade["symbol"] = (resolve_contracts("current").get(trade["index_key"]) or {}).get("symbol", "")
    row = contract_row(trade["symbol"]) if trade["symbol"] else None
    if row is None and trade["index_key"] and trade["expiry"]:
        frame = catalogue(index_options=True)
        match = frame[frame["name"].eq(CONTRACT_NAMES[trade["index_key"]]) & frame["expiry"].dt.date.eq(trade["expiry"])
                      & frame["instrument_type"].eq(instrument)]
        if instrument != "FUT":
            match = match[match["strike"].astype(float).eq(trade["strike"] or -1)]
        row = match.iloc[0] if not match.empty else None
    if row is not None:
        trade["symbol"], trade["lot_size"] = row["tradingsymbol"], int(row["lot_size"])
        trade["expiry"] = row["expiry"].date()
        if instrument != "FUT":
            trade["strike"] = float(row["strike"])
        if row["name"] in CONTRACT_NAMES.values():
            trade["index_key"] = next(key for key, name in CONTRACT_NAMES.items() if name == row["name"])
    else:
        trade["lot_size"] = int(number(data, "lotSize", minimum=1) or 0)
        if not trade["symbol"] or not trade["lot_size"]:
            raise ValueError("Pick a contract, or enter its symbol and lot size.")
    if instrument != "FUT" and not trade["strike"]:
        raise ValueError("Enter the option strike.")
    return trade


def market_inputs(trade):
    """Spot, years to expiry, IV and latest premium for an index option from the recorded/live chain."""
    if not trade["index_key"] or not trade["expiry"]:
        return None, None, None, None, None
    chain = chain_payload(trade["index_key"], trade["expiry"])
    spot = chain.get("underlying")
    years = years_to_expiry(trade["expiry"], now_ist().replace(tzinfo=None))
    row = next((row for row in chain.get("rows", []) if row["strike"] == trade.get("strike")), None)
    side = row and row.get("call" if trade["instrument"] == "CE" else "put")
    return chain, spot, years, side and side.get("iv"), side and side.get("ltp")


def broker_margin(trade):
    client, _ = broker()
    if not client or not trade["symbol"]:
        return None
    try:
        exchange = "BFO" if trade["index_key"] == "sensex" else "NFO"
        result = client.order_margins([{"exchange": exchange, "tradingsymbol": trade["symbol"], "transaction_type": "SELL",
                                        "variety": "regular", "product": "NRML", "order_type": "MARKET",
                                        "quantity": trade["lots"] * trade["lot_size"]}])
        return float(result[0]["total"])
    except Exception:
        return None


def plan_for(user, profile, trade, payload, now):
    card = card_for(payload, trade["index_key"]) if trade["index_key"] else None
    danger = [note.message for note in MarketNote.objects.filter(date=now.date(), level="danger")]
    practice = profile.practice_mode
    chain, spot, years, iv, ltp = market_inputs(trade)
    if trade["entry"] is None:
        trade["entry"] = ltp if trade["instrument"] != "FUT" else (card and card["price"])
    if trade["entry"] is None:
        raise ValueError("Enter the price you plan to trade at.")
    result = {"trade": {key: (value.isoformat() if isinstance(value, dt.date) else value) for key, value in trade.items()},
              "checklist": coach.checklist(user, profile, card, danger, now, practice),
              "warnings": coach.coach_warnings(user, trade, now), "dangerNow": coach.danger_times(user, now)["now"]}
    stop = trade["stop"] or default_stop(trade["side"], trade["entry"], trade["instrument"])
    level = coach.licence(user, profile, now)["level"]
    capital = profile.practice_balance if practice else profile.capital
    result["sizing"] = {**position_size(capital, profile.risk_per_trade_pct, trade["entry"], stop, trade["lot_size"],
                                        2 if practice else level, trade["lots"]), "stop": stop, "stopSuggested": trade["stop"] is None}
    result["whatIf"] = what_if(trade, spot, years, iv)
    label = card["label"] if card else trade["symbol"]
    if trade["instrument"] != "FUT":
        when = "3:30 pm today" if trade["expiry"] == now.date() else f"expiry on {trade['expiry']:%d %b}"
        if trade["side"] == "buy":
            result["breakEven"] = break_even_odds(spot, trade["strike"], trade["entry"], trade["instrument"], years, iv, label, when)
        else:
            result["sellerAlarm"] = seller_alarm(spot or trade["strike"], trade["strike"], trade["instrument"], trade["entry"], trade["lots"],
                                                 trade["lot_size"], years, iv, label, broker_margin(trade))
        option_row = next((row for row in (chain or {}).get("rows", []) if row["strike"] == trade["strike"]), None)
        side = option_row and option_row.get("call" if trade["instrument"] == "CE" else "put")
        if side and side.get("lottery"):
            result["lottery"] = "Lottery ticket. Very likely to become zero" + (" today." if trade["expiry"] == now.date() else " by expiry.")
        if side and side.get("decayPerHour"):
            result["timeLoss"] = f"This option loses about ₹{side['decayPerHour'] * trade['lots']:,.0f} every hour for your {trade['lots']} lot{'s' if trade['lots'] != 1 else ''}, even if the market doesn't move."
    warning = stock_expiry_warning(trade, spot or trade["entry"], now.date())
    if warning:
        result["stockExpiry"] = warning
    return result


def enforce(user, profile, trade, now):
    if profile.practice_mode:
        return None
    level = coach.licence(user, profile, now)
    if not level["realAllowed"]:
        return "Learner's licence: real trading unlocks after 20 disciplined practice trades. Use practice money for now."
    cool = coach.cooling_off(user, profile, now)
    if cool.get("active"):
        return cool["text"]
    if level["maxLots"] and trade["lots"] > level["maxLots"]:
        return "Small licence: one lot at a time until you complete 20 disciplined real trades."
    return None


@never_cache
@require_GET
def overview(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    now = now_ist()
    profile = coach.profile_for(user)
    payload = decision_payload(now)
    prices = {card["key"]: card["price"] for card in payload["cards"]}
    open_trades = []
    for trade in Trade.objects.filter(user=user, exit__isnull=True)[:30]:
        item = coach.trade_payload(trade)
        current = None
        if trade.instrument == "FUT" and trade.index_key:
            current = prices.get(trade.index_key)
        elif trade.index_key and trade.expiry and trade.strike:
            row = next((row for row in chain_payload(trade.index_key, trade.expiry).get("rows", []) if row["strike"] == trade.strike), None)
            current = row and (row.get("call" if trade.instrument == "CE" else "put") or {}).get("ltp")
        item["current"] = current
        item["protect"] = protect_profit(trade.side, trade.entry, current, trade.lots, trade.lot_size) if current else None
        item["stockExpiry"] = stock_expiry_warning({"index_key": trade.index_key, "expiry": trade.expiry, "lots": trade.lots, "lot_size": trade.lot_size,
                                                    "instrument": trade.instrument, "side": trade.side, "strike": trade.strike, "symbol": trade.symbol},
                                                   current or trade.entry, now.date())
        open_trades.append(item)
    ok, mind_text, checkin = coach.mind_status(user, now)
    expiry_levels = {}
    for card in payload["cards"]:
        if card["expiry"]:
            chain = chain_payload(card["key"], dt.date.fromisoformat(card["expiry"]["date"]))
            expiry_levels[card["key"]] = expiry_close_level(chain.get("rows", []), chain.get("underlying"))
    return JsonResponse({
        "type": "success", "profile": profile_payload(profile), "licence": coach.licence(user, profile, now),
        "coolingOff": coach.cooling_off(user, profile, now), "checkin": {"done": bool(checkin), "ok": ok, "text": mind_text},
        "dangerTimes": coach.danger_times(user, now), "emotionCost": coach.emotion_cost(user, now), "lessons": coach.plan_lessons(user),
        "monthPnl": round(coach.month_real_pnl(user, now)), "openTrades": open_trades,
        "recentTrades": [coach.trade_payload(trade) for trade in Trade.objects.filter(user=user, exit__isnull=False)[:30]],
        "optionCost": option_cost(india_vix()), "expiryLevels": expiry_levels,
        "cards": [{key: card[key] for key in ("key", "label", "price", "light", "expiry")} for card in payload["cards"]],
        "calendar": payload["calendar"], "disclaimer": payload["disclaimer"],
    })


@csrf_exempt
@require_http_methods(["POST"])
def update_profile(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    try:
        data, profile = body(request), coach.profile_for(user)
        for key, field, minimum in (("capital", "capital", 0), ("riskPct", "risk_per_trade_pct", 0.1), ("monthlyLossLimit", "monthly_loss_limit", 0)):
            value = number(data, key, minimum=minimum)
            if value is not None:
                setattr(profile, field, value)
        if profile.risk_per_trade_pct > 5:
            raise ValueError("Risking more than 5% of your money on one trade is not allowed.")
        if "practiceMode" in data:
            profile.practice_mode = bool(data["practiceMode"])
        if data.get("language") in dict(TraderProfile.LANGUAGES):
            profile.language = data["language"]
        if "telegramChatId" in data:
            profile.telegram_chat_id = str(data["telegramChatId"] or "").strip()[:40]
        if data.get("resetPractice"):
            profile.practice_balance = 100000
        profile.save()
        return JsonResponse({"type": "success", "profile": profile_payload(profile)})
    except ValueError as exc:
        return error(str(exc))


@csrf_exempt
@require_http_methods(["POST"])
def checkin(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    data, today = body(request), now_ist().date()
    CheckIn.objects.update_or_create(user=user, date=today, defaults={
        "slept_well": bool(data.get("sleptWell")), "upset": bool(data.get("upset")), "chasing_loss": bool(data.get("chasingLoss"))})
    ok, text, _ = coach.mind_status(user, now_ist())
    return JsonResponse({"type": "success", "ok": ok, "text": text})


@csrf_exempt
@require_http_methods(["POST"])
def plan(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    try:
        now = now_ist()
        profile = coach.profile_for(user)
        trade = describe(body(request))
        return JsonResponse({"type": "success", **plan_for(user, profile, trade, decision_payload(now), now)})
    except ValueError as exc:
        return error(str(exc))


@csrf_exempt
@require_http_methods(["GET", "POST"])
def trades(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    if request.method == "GET":
        return JsonResponse({"type": "success", "trades": [coach.trade_payload(trade) for trade in Trade.objects.filter(user=user)[:100]]})
    try:
        now = now_ist()
        profile = coach.profile_for(user)
        trade = describe(body(request))
        blocked = enforce(user, profile, trade, now)
        if blocked:
            return error(blocked, 403)
        payload = decision_payload(now)
        planned = plan_for(user, profile, dict(trade), payload, now)
        card = card_for(payload, trade["index_key"]) if trade["index_key"] else None
        record = Trade.objects.create(
            user=user, opened_at=coach.naive(now), practice=profile.practice_mode, index_key=trade["index_key"], symbol=trade["symbol"], instrument=trade["instrument"],
            strike=trade["strike"], expiry=trade["expiry"], side=trade["side"], lots=trade["lots"], lot_size=trade["lot_size"],
            entry=planned["trade"]["entry"], stop=planned["sizing"]["stop"], emotion=trade["emotion"],
            light_at_entry=card["light"]["color"] if card else "", checklist_ready=planned["checklist"]["ready"],
            alert=Alert.objects.filter(index_key=trade["index_key"], created_at__gte=coach.naive(now) - dt.timedelta(minutes=30)).first() if trade["index_key"] else None,
            note=str(body(request).get("note", ""))[:240])
        return JsonResponse({"type": "success", "trade": coach.trade_payload(record), "warnings": planned["warnings"]})
    except ValueError as exc:
        return error(str(exc))


@csrf_exempt
@require_http_methods(["POST"])
def close_trade(request, trade_id):
    user, failure = user_or_error(request)
    if failure:
        return failure
    trade = Trade.objects.filter(user=user, pk=trade_id, exit__isnull=True).first()
    if not trade:
        return error("Open trade not found.", 404)
    try:
        trade.exit = number(body(request), "exit", required=True, minimum=0)
    except ValueError as exc:
        return error(str(exc))
    trade.closed_at = coach.naive(now_ist())
    trade.save(update_fields=["exit", "closed_at"])
    if trade.practice:
        profile = coach.profile_for(user)
        profile.practice_balance += trade.pnl
        profile.save(update_fields=["practice_balance"])
    lesson = next((item for item in coach.plan_lessons(user)["lessons"] if item["tradeId"] == trade.id), None)
    return JsonResponse({"type": "success", "trade": coach.trade_payload(trade), "lesson": lesson})


@never_cache
@require_GET
def alerts(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    now = now_ist()
    try:
        year, month = (int(part) for part in request.GET.get("month", f"{now:%Y-%m}").split("-"))
        card = report_card(year, month)
    except ValueError:
        return error("Select a valid month.")
    ok, broken = verify_record()
    return JsonResponse({"type": "success", "alerts": [alert_payload(alert) for alert in Alert.objects.all()[:100]],
                         "reportCard": card, "record": {"intact": ok, "brokenAt": broken, "count": Alert.objects.count()}})


@never_cache
@require_GET
def replay_day(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    days = coach.available_days()
    try:
        day = dt.date.fromisoformat(request.GET.get("date") or (days[0] if days else now_ist().date().isoformat()))
    except ValueError:
        return error("Select a valid date.")
    return JsonResponse({"type": "success", "days": days, **coach.replay(day)})


@never_cache
@require_GET
def expiry_report(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    index_key = request.GET.get("index", "nifty")
    if index_key not in CONTRACT_NAMES:
        return error("Select NIFTY, BANKNIFTY or SENSEX.")
    try:
        day = dt.date.fromisoformat(request.GET.get("date") or now_ist().date().isoformat())
    except ValueError:
        return error("Select a valid date.")
    return JsonResponse({"type": "success", **coach.expiry_report(user, index_key, day)})


@csrf_exempt
@require_http_methods(["POST"])
def mentor_link(request):
    user, failure = user_or_error(request)
    if failure:
        return failure
    profile = coach.profile_for(user)
    profile.mentor_token = "" if body(request).get("revoke") else secrets.token_urlsafe(24)
    profile.save(update_fields=["mentor_token"])
    return JsonResponse({"type": "success", "mentorLink": profile.mentor_token or None})


@never_cache
@require_GET
def mentor_view(request, token):
    """Read-only view a trader shares with their mentor. Anyone holding the link can read it until it is revoked."""
    profile = TraderProfile.objects.filter(mentor_token=token).exclude(mentor_token="").select_related("user").first()
    if not profile or len(token) < 20:
        return error("This mentor link is not valid or was turned off.", 404)
    user, now = profile.user, now_ist()
    count, pct = coach.discipline(Trade.objects.filter(user=user))
    return JsonResponse({"type": "success", "trader": user.username[:2] + "***", "licence": coach.licence(user, profile, now),
                         "discipline": {"trades": count, "followedPct": pct}, "emotionCost": coach.emotion_cost(user, now),
                         "lessons": coach.plan_lessons(user), "dangerTimes": coach.danger_times(user, now),
                         "trades": [coach.trade_payload(trade) for trade in Trade.objects.filter(user=user)[:60]]})

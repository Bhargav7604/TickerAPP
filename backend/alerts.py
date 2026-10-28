"""Fewer, better alerts with a locked record and an automatic report card.

An alert is raised from the home-card signals (trend, trap, last hour of expiry). It is graded
Strong / Medium / Weak and marked Wait (seen once) or Confirmed (seen on two checks in a row).
Each alert's hash covers the previous one, so any later edit to the record is detectable.
"""
import datetime as dt
import hashlib
import json

import requests
from django.db import transaction

from .decision import EXPIRY_LAST_HOUR, LABELS, decision_payload
from .logger import log
from .market_contracts import MARKET_TZ
from .models import Alert, MarketSnapshot, TelegramSettings, TraderProfile

MAX_ALERTS_PER_DAY = 8
REPEAT_GAP = dt.timedelta(minutes=45)
CHECK_AFTER = dt.timedelta(minutes=30)
RIGHT_MOVE_PCT = 0.1
GENESIS = "0" * 64
_seen = {}


def grade(card):
    oi = abs((card.get("numbers") or {}).get("oi", {}).get("strength") or 0) if (card.get("numbers") or {}).get("oi") else 0
    move = abs(card["direction"].get("move") or 0)
    if oi >= 40 and move >= 0.3:
        return "strong"
    if oi >= 20 and move >= 0.15:
        return "medium"
    return "weak"


def candidate(card, now):
    if card["trap"]:
        expects = "down" if card["direction"]["code"] == "up" else "up"
        return {"kind": "trap", "direction": expects, "message": f"{card['label']}: {card['trap']['message']}"}
    if card["expiry"] and card["expiry"]["isToday"] and now.time() >= EXPIRY_LAST_HOUR:
        return {"kind": "expiry-hour", "direction": "",
                "message": f"{card['label']}: Last hour of expiry. Prices can jump fast. Keep your exit ready or stay out."}
    if card["light"]["color"] == "green" and card["direction"]["code"] in ("up", "down"):
        word = "rising" if card["direction"]["code"] == "up" else "falling"
        return {"kind": "trend", "direction": card["direction"]["code"],
                "message": f"{card['label']} is {word} and big players agree."}
    return None


def record_hash(previous, fields):
    content = json.dumps(fields, sort_keys=True, default=str)
    return hashlib.sha256((previous + content).encode()).hexdigest()


def naive_ist(value):
    """Times are stored as plain IST clock times (USE_TZ is off)."""
    return value.astimezone(MARKET_TZ).replace(tzinfo=None) if value.tzinfo else value


def locked_fields(alert):
    fields = {field: getattr(alert, field) for field in Alert.LOCKED_FIELDS if field not in ("previous_hash", "record_hash")}
    fields["created_at"] = naive_ist(alert.created_at).strftime("%Y-%m-%dT%H:%M:%S+05:30")
    fields["price"] = repr(float(alert.price))  # 22600 and 22600.0 must hash the same after a database round trip
    return fields


@transaction.atomic
def create_alert(now, index_key, kind, strength, status, direction, message, price):
    previous = Alert.objects.select_for_update().order_by("-created_at", "-id").values_list("record_hash", flat=True).first() or GENESIS
    alert = Alert(created_at=naive_ist(now).replace(microsecond=0), index_key=index_key, kind=kind, strength=strength, status=status,
                  direction=direction, message=message, price=price, previous_hash=previous)
    alert.record_hash = record_hash(previous, locked_fields(alert))
    alert.save()
    return alert


def verify_record():
    """Returns (ok, first broken alert id). Recomputes every hash from the start of the chain."""
    previous = GENESIS
    for alert in Alert.objects.order_by("created_at", "id"):
        if alert.previous_hash != previous or alert.record_hash != record_hash(previous, locked_fields(alert)):
            return False, alert.id
        previous = alert.record_hash
    return True, None


def send_telegram(alert):
    settings = TelegramSettings.objects.filter(enabled=True).exclude(bot_token="").first()
    if not settings:
        return 0
    text = f"Utraders · {alert.strength.title()} · {alert.status.title()}\n{alert.message}\nPrice {alert.price:,.2f} at {naive_ist(alert.created_at):%H:%M} IST\nUtraders describes the market; it does not tell you to buy or sell."
    sent = 0
    for chat_id in TraderProfile.objects.exclude(telegram_chat_id="").values_list("telegram_chat_id", flat=True):
        try:
            requests.post(f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
                          json={"chat_id": chat_id, "text": text}, timeout=6).raise_for_status()
            sent += 1
        except Exception as exc:
            log(f"Telegram alert not delivered ({type(exc).__name__}).", "ERROR")
    return sent


def generate_alerts(now=None, payload=None):
    now = now or dt.datetime.now(MARKET_TZ)
    payload = payload or decision_payload(now)
    if not payload["marketOpen"]:
        return []
    day_start = naive_ist(now).replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today = Alert.objects.filter(created_at__gte=day_start).count()
    created = []
    for card in payload["cards"]:
        found = None if card["late"] or card["price"] is None else candidate(card, now)
        key = (card["key"], found and found["kind"], found and found["direction"])
        confirmed = found is not None and _seen.get(card["key"]) == key
        _seen[card["key"]] = key if found else None
        if not found or sent_today >= MAX_ALERTS_PER_DAY:
            continue
        strength = grade(card)
        if not confirmed and strength != "strong":
            continue
        recent = Alert.objects.filter(index_key=card["key"], kind=found["kind"], direction=found["direction"],
                                      created_at__gte=naive_ist(now) - REPEAT_GAP).exists()
        if recent:
            continue
        alert = create_alert(now, card["key"], found["kind"], strength, "confirmed" if confirmed else "wait",
                             found["direction"], found["message"], card["price"])
        created.append(alert)
        sent_today += 1
        send_telegram(alert)
    return created


def current_price(index_key, at):
    latest = MarketSnapshot.objects.filter(index_key=index_key, contract_month="current", instrument_type="FUT",
                                           bucket_time__lte=naive_ist(at)).order_by("-bucket_time").first()
    return latest.index_level if latest else None


def check_outcomes(now=None):
    """Scores each trend or trap alert 30 minutes after it was sent: did price move its way by at least 0.1%?"""
    now = now or dt.datetime.now(MARKET_TZ)
    checked = 0
    now = naive_ist(now)
    for alert in Alert.objects.filter(checked_at__isnull=True, created_at__lte=now - CHECK_AFTER):
        if not alert.direction:
            alert.outcome, alert.checked_at = "info", now
            alert.save(update_fields=["outcome", "checked_at"])
            continue
        price = current_price(alert.index_key, naive_ist(alert.created_at) + CHECK_AFTER)
        if price is None:
            continue
        move = (price - alert.price) / alert.price * 100 * (1 if alert.direction == "up" else -1)
        alert.check_price, alert.checked_at = price, now
        alert.outcome = "right" if move >= RIGHT_MOVE_PCT else "wrong"
        alert.save(update_fields=["check_price", "checked_at", "outcome"])
        checked += 1
    return checked


def report_card(year, month):
    start = dt.datetime(year, month, 1)
    end = dt.datetime(year + (month == 12), month % 12 + 1, 1)
    alerts = Alert.objects.filter(created_at__gte=start, created_at__lt=end)
    rows = {strength: {"right": 0, "wrong": 0, "pending": 0} for strength in ("strong", "medium", "weak")}
    for alert in alerts:
        if alert.outcome in ("right", "wrong"):
            rows[alert.strength][alert.outcome] += 1
        elif not alert.outcome:
            rows[alert.strength]["pending"] += 1
    right = sum(row["right"] for row in rows.values())
    wrong = sum(row["wrong"] for row in rows.values())
    scored = right + wrong
    return {"month": f"{start:%B %Y}", "right": right, "wrong": wrong, "byStrength": rows,
            "hitRate": round(right / scored * 100) if scored else None,
            "text": f"{start:%B}: {right} of {scored} alerts were right." if scored else f"{start:%B}: no alerts have been checked yet."}


def alert_payload(alert):
    return {"id": alert.id, "time": int(naive_ist(alert.created_at).replace(tzinfo=MARKET_TZ).timestamp()), "index": alert.index_key, "label": LABELS.get(alert.index_key, alert.index_key),
            "kind": alert.kind, "strength": alert.strength, "status": alert.status, "direction": alert.direction,
            "message": alert.message, "price": alert.price, "outcome": alert.outcome or None,
            "checkPrice": alert.check_price, "hash": alert.record_hash}


def run_alert_cycle():
    """Scheduler entry point: raise new alerts, then score older ones."""
    try:
        generate_alerts()
        check_outcomes()
    except Exception as exc:
        log(f"Alert cycle failed ({type(exc).__name__}: {exc}).", "ERROR")

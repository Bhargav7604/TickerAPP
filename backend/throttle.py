"""Small database-backed limits shared by every web worker: failed logins and repeat alert emails."""

import datetime as dt
import math

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import RequestThrottle

LOGIN_LIMIT = 5
LOGIN_WINDOW = dt.timedelta(minutes=15)
LOGIN_BLOCK = dt.timedelta(minutes=15)
ALERT_EMAIL_EVERY = dt.timedelta(minutes=5)


def _row(key, now):
    try:
        with transaction.atomic():
            return RequestThrottle.objects.select_for_update().get_or_create(key=key, defaults={"window_start": now})
    except IntegrityError:  # another worker created it first
        return RequestThrottle.objects.get(key=key), False


def blocked_minutes(key):
    """Minutes left on a block for this key, or 0 when it may try again."""
    now = timezone.now()
    row = RequestThrottle.objects.filter(key=key, blocked_until__gt=now).first()
    return math.ceil((row.blocked_until - now).total_seconds() / 60) if row else 0


def record_failure(key, limit=LOGIN_LIMIT, window=LOGIN_WINDOW, block=LOGIN_BLOCK):
    now = timezone.now()
    row, _ = _row(key, now)
    if now - row.window_start > window:
        row.count, row.window_start, row.blocked_until = 0, now, None
    row.count += 1
    if row.count >= limit:
        row.blocked_until = now + block
    row.save()


def clear(key):
    RequestThrottle.objects.filter(key=key).delete()


def allow_once(key, every=ALERT_EMAIL_EVERY):
    """True at most once per `every` for this key."""
    now = timezone.now()
    row, created = _row(key, now)
    if created:
        row.count = 1
        row.save(update_fields=["count"])
        return True
    if now - row.window_start >= every:
        row.window_start, row.count = now, 1
        row.save(update_fields=["window_start", "count"])
        return True
    return False

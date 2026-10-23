"""Three-minute open-interest recorder for NIFTY, BANKNIFTY and SENSEX option chains.

Live quotes are saved every three minutes. Zerodha's 3-minute history then fills
the rest of the session (late starts, a sleeping laptop) and supplies the previous
day's closing OI, so OI change is measured the same way as broker option chains.
"""
import datetime as dt
import time
from bisect import bisect_left

from django.db.models import Count
from kiteconnect.exceptions import TokenException

from .equity import broker, catalogue
from .instruments import SPOT_INSTRUMENTS, resolve_spot_tokens
from .logger import log
from .market_contracts import CONTRACT_NAMES, MARKET_TZ, get_master_contract
from .models import OptionOIBaseline, OptionOISnapshot

OI_INTERVAL_MINUTES = 3
STRIKES_EACH_SIDE = 15
EXPIRIES_PER_INDEX = 2
QUOTE_BATCH_SIZE = 450
# Zerodha allows 3 history calls a second; a run stays well inside the 3-minute schedule.
HISTORY_CALLS_PER_RUN = 120
HISTORY_PAUSE_SECONDS = 0.34
HISTORY_RETRY = dt.timedelta(minutes=15)
HISTORY_LOOKBACK_DAYS = 6
RETENTION_DAYS = 14
MARKET_OPEN = dt.time(9, 15)
MARKET_CLOSE = dt.time(15, 30)
STEP = dt.timedelta(minutes=OI_INTERVAL_MINUTES)
SPOT_KEYS = {key: f"{exchange}:{symbol}" for key, (exchange, symbol) in SPOT_INSTRUMENTS.items()}
_history_attempts = {}


def bucket_for(now):
    return now.replace(minute=now.minute - now.minute % OI_INTERVAL_MINUTES, second=0, microsecond=0, tzinfo=None)


def is_recording_time(now):
    return now.weekday() < 5 and MARKET_OPEN <= now.time() <= dt.time(MARKET_CLOSE.hour, MARKET_CLOSE.minute, 59)


def select_strikes(strikes, spot, recorded=(), each_side=STRIKES_EACH_SIDE):
    """Strikes within each_side steps of ATM, plus any already recorded today so series stay continuous."""
    strikes = sorted(set(strikes))
    if not strikes or spot is None:
        return sorted(set(recorded))
    position = bisect_left(strikes, spot)
    atm = min(range(max(0, position - 1), min(len(strikes), position + 1)), key=lambda i: abs(strikes[i] - spot))
    window = strikes[max(0, atm - each_side):atm + each_side + 1]
    return sorted(set(window) | (set(recorded) & set(strikes)))


def option_rows(today):
    frame = catalogue(index_options=True)
    selections = {}
    for key, name in CONTRACT_NAMES.items():
        rows = frame[frame["name"].eq(name)]
        expiries = sorted(rows["expiry"].dt.date.unique())[:EXPIRIES_PER_INDEX]
        selections[key] = {expiry: rows[rows["expiry"].dt.date.eq(expiry)] for expiry in expiries if expiry >= today}
    return selections


def quote_all(client, keys):
    quotes = {}
    for start in range(0, len(keys), QUOTE_BATCH_SIZE):
        quotes.update(client.quote(*keys[start:start + QUOTE_BATCH_SIZE]))
    return quotes


def naive_ist(value):
    return value.astimezone(MARKET_TZ).replace(tzinfo=None) if value.tzinfo else value


def history_points(candles, today, bucket):
    """(previous day's last candle, [(bucket_time, candle)]) where a candle counts at its close."""
    previous = [candle for candle in candles if naive_ist(candle["date"]).date() < today]
    points = []
    for candle in candles:
        start = naive_ist(candle["date"])
        if start.date() == today and start + STEP <= bucket:
            points.append((start + STEP, candle))
    return (previous[-1] if previous else None), points


def backfill_history(client, instruments, today, bucket, now):
    """Fill today's gaps and previous-close baselines from Zerodha 3-minute history, nearest-to-ATM first."""
    day_start = dt.datetime.combine(today, dt.time.min)
    first_bucket = dt.datetime.combine(today, MARKET_OPEN) + STEP
    expected = max(0, (bucket - first_bucket) // STEP + 1)
    counts = {(row["index_key"], row["expiry"], row["strike"], row["option_type"]): row["n"]
              for row in OptionOISnapshot.objects.filter(bucket_time__gte=first_bucket, bucket_time__lt=day_start + dt.timedelta(days=1))
              .values("index_key", "expiry", "strike", "option_type").annotate(n=Count("id"))}
    have_base = set(OptionOIBaseline.objects.filter(trade_date=today).values_list("index_key", "expiry", "strike", "option_type"))
    expiry_rank = {}
    for key, expiry, *_ in instruments:
        expiry_rank.setdefault(key, set()).add(expiry)
    expiry_rank = {key: sorted(expiries) for key, expiries in expiry_rank.items()}
    wanted = [item for item in instruments
              if (item[:4] not in have_base or counts.get(item[:4], 0) < expected - 1)
              and now - _history_attempts.get(item[:4], dt.datetime.min) >= HISTORY_RETRY]
    wanted.sort(key=lambda item: (expiry_rank[item[0]].index(item[1]), abs(item[2] - (item[5] or item[2]))))
    if not wanted:
        return 0
    spot_tokens = resolve_spot_tokens(get_master_contract())
    spots, baselines, rows, calls = {}, [], [], 0
    start = dt.datetime.combine(today - dt.timedelta(days=HISTORY_LOOKBACK_DAYS), MARKET_OPEN)
    for index_key, expiry, strike, option_type, token, _ in wanted:
        if calls >= HISTORY_CALLS_PER_RUN:
            break
        try:
            if index_key not in spots and spot_tokens.get(index_key):
                calls += 1
                spot_candles = client.historical_data(spot_tokens[index_key], dt.datetime.combine(today, MARKET_OPEN), now, "3minute")
                spots[index_key] = {at: candle["close"] for at, candle in history_points(spot_candles, today, bucket)[1]}
                time.sleep(HISTORY_PAUSE_SECONDS)
            calls += 1
            candles = client.historical_data(token, start, now, "3minute", oi=True)
        except TokenException:
            raise
        except Exception as exc:
            log(f"OI history unavailable ({type(exc).__name__}); will retry on the next run.", "ERROR")
            break
        _history_attempts[(index_key, expiry, strike, option_type)] = now
        previous, points = history_points(candles, today, bucket)
        if previous and previous.get("oi") is not None:
            baselines.append(OptionOIBaseline(index_key=index_key, expiry=expiry, strike=strike, option_type=option_type,
                                              trade_date=today, prev_oi=float(previous["oi"])))
        rows.extend(OptionOISnapshot(
            index_key=index_key, expiry=expiry, strike=strike, option_type=option_type, bucket_time=at,
            underlying=spots.get(index_key, {}).get(at), oi=float(candle["oi"]), ltp=candle.get("close"),
            prev_close=previous.get("close") if previous else None) for at, candle in points if candle.get("oi") is not None)
        time.sleep(HISTORY_PAUSE_SECONDS)
    OptionOIBaseline.objects.bulk_create(baselines, ignore_conflicts=True)
    # Live quotes win over history for the same bucket.
    OptionOISnapshot.objects.bulk_create(rows, ignore_conflicts=True)
    return len(rows)


def record_option_oi(now=None, client=None):
    now = now or dt.datetime.now(MARKET_TZ)
    if not is_recording_time(now):
        return 0
    if client is None:
        client, _ = broker()
        if client is None:
            return 0
    today = now.date()
    bucket = bucket_for(now)
    try:
        selections = option_rows(today)
        spot_quotes = client.quote(*SPOT_KEYS.values())
        instruments = {}
        for key, expiries in selections.items():
            spot = (spot_quotes.get(SPOT_KEYS[key]) or {}).get("last_price")
            for expiry, rows in expiries.items():
                recorded = OptionOISnapshot.objects.filter(
                    index_key=key, expiry=expiry, bucket_time__gte=dt.datetime.combine(today, dt.time.min),
                ).values_list("strike", flat=True).distinct()
                strikes = select_strikes(rows["strike"].astype(float).tolist(), spot, list(recorded))
                for _, row in rows[rows["strike"].astype(float).isin(strikes)].iterrows():
                    instruments[f"{row['exchange']}:{row['tradingsymbol']}"] = (
                        key, expiry, float(row["strike"]), row["instrument_type"], int(row["instrument_token"]), spot)
        quotes = quote_all(client, list(instruments))
        snapshots = []
        for name, (key, expiry, strike, option_type, _, spot) in instruments.items():
            quote = quotes.get(name)
            if not quote or quote.get("oi") is None:
                continue
            snapshots.append(OptionOISnapshot(
                index_key=key, expiry=expiry, strike=strike, option_type=option_type, bucket_time=bucket,
                underlying=spot, oi=float(quote["oi"]), ltp=quote.get("last_price"),
                prev_close=(quote.get("ohlc") or {}).get("close"), volume=quote.get("volume")))
        OptionOISnapshot.objects.bulk_create(
            snapshots, update_conflicts=True,
            unique_fields=["index_key", "expiry", "strike", "option_type", "bucket_time"],
            update_fields=["underlying", "oi", "ltp", "prev_close", "volume"])
        backfill_history(client, list(instruments.values()), today, bucket, now.replace(tzinfo=None))
        if bucket.time() == MARKET_OPEN:
            OptionOISnapshot.objects.filter(bucket_time__lt=bucket - dt.timedelta(days=RETENTION_DAYS)).delete()
            OptionOIBaseline.objects.filter(trade_date__lt=today - dt.timedelta(days=RETENTION_DAYS)).delete()
        return len(snapshots)
    except TokenException as exc:
        log(f"Kite TokenException in OI recorder: {exc}", "ERROR")
    except Exception as exc:
        log(f"Error {exc} occurred while recording option OI.", "ERROR")
    return 0

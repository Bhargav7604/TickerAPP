import datetime as dt
import math
import traceback
from zoneinfo import ZoneInfo

from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from .logger import log
from .market_contracts import (
    CONTRACT_NAMES,
    get_master_contract,
    resolve_atm_option_rows,
    resolve_contract_rows,
)
from .models import KiteSettings, MarketSnapshot


MARKET_TZ = ZoneInfo("Asia/Kolkata")
# Real trading starts at 09:15 IST. The pre-open auction window
# (09:00-09:15) is intentionally skipped — Kite returns yesterday's stale
# cumulative volume during that window, which then corrupts the AC/DD
# volume baseline for the first post-open bars.
MARKET_OPEN_MINUTES = (9 * 60) + 15
MARKET_CLOSE_MINUTES = (15 * 60) + 30
SNAPSHOT_INTERVAL_MINUTES = 5


def get_market_minutes(value):
    return (value.hour * 60) + value.minute


def is_market_time(value):
    minutes = get_market_minutes(value)
    return value.weekday() < 5 and MARKET_OPEN_MINUTES <= minutes <= MARKET_CLOSE_MINUTES


def current_bucket_time(value):
    bucket_minute = (value.minute // SNAPSHOT_INTERVAL_MINUTES) * SNAPSHOT_INTERVAL_MINUTES
    return value.replace(minute=bucket_minute, second=0, microsecond=0)


def quote_value(quote, *keys):
    for key in keys:
        value = quote.get(key)
        if value is not None:
            return value

    return None


def save_snapshot(contract_month, key, row, quote, bucket_time):
    index_level = quote_value(quote, "last_price")
    buy_quantity = quote_value(quote, "buy_quantity", "total_buy_quantity")
    sell_quantity = quote_value(quote, "sell_quantity", "total_sell_quantity")
    volume_traded = quote_value(quote, "volume", "volume_traded")
    vwap = quote_value(quote, "average_price", "average_traded_price")
    lot_size = float(row["lot_size"] or 0)

    if index_level is None or buy_quantity is None or sell_quantity is None or lot_size <= 0:
        return False

    symbol = row["tradingsymbol"]
    instrument_type = row.get("instrument_type") or "FUT"
    strike = row.get("strike")
    try:
        strike = float(strike)
        strike = strike if math.isfinite(strike) else None
    except (TypeError, ValueError):
        strike = None
    net_lots = (float(buy_quantity) - float(sell_quantity)) / lot_size
    demand_supply_ratio = None
    sell_quantity_float = float(sell_quantity)
    if sell_quantity_float > 0:
        demand_supply_ratio = float(buy_quantity) / sell_quantity_float
    volume_traded = float(volume_traded) if volume_traded is not None else None
    vwap = float(vwap) if vwap is not None else None
    previous_snapshot = MarketSnapshot.objects.filter(
        index_key=key,
        contract_month=contract_month,
        symbol=symbol,
        bucket_time__lt=bucket_time,
        volume_traded__isnull=False,
    ).order_by("-bucket_time").first()
    interval_volume = None

    # Only compute the per-interval delta when the previous snapshot is
    # from the same trading day. Kite's volume_traded is a daily
    # cumulative that resets at session open, so comparing today's first
    # bar against yesterday's last bar yields a meaningless baseline
    # (clamped to 0 or a tiny positive number) that downstream AC/DD
    # analysis turns into phantom 10,000%+ volume surges on the
    # second bar of the day.
    if (
        volume_traded is not None
        and previous_snapshot
        and previous_snapshot.volume_traded is not None
        and previous_snapshot.bucket_time.date() == bucket_time.date()
    ):
        interval_volume = max(0.0, volume_traded - previous_snapshot.volume_traded)

    MarketSnapshot.objects.update_or_create(
        index_key=key,
        contract_month=contract_month,
        symbol=symbol,
        bucket_time=bucket_time,
        defaults={
            "instrument_type": instrument_type,
            "strike": strike,
            "index_level": round(float(index_level), 2),
            "net_lots": round(net_lots, 2),
            "demand_supply_ratio": round(demand_supply_ratio, 2) if demand_supply_ratio is not None else None,
            "volume_traded": volume_traded,
            "interval_volume": interval_volume,
            "vwap": vwap,
            "source": "backend",
        },
    )

    return True


def record_market_snapshot():
    now = dt.datetime.now(MARKET_TZ)

    if not is_market_time(now):
        return

    kite_settings = KiteSettings.objects.order_by("-updated_at", "-id").first()
    if not kite_settings or not kite_settings.api_key or not kite_settings.access_token:
        return

    try:
        master_contract = get_master_contract()
        contract_rows = resolve_contract_rows(master_contract)
        future_instruments = {}

        for (contract_month, key), row in contract_rows.items():
            symbol = row["tradingsymbol"]
            exchange = row.get("exchange") or "NFO"
            future_instruments.setdefault(f"{exchange}:{symbol}", []).append((contract_month, key, row))

        if not future_instruments:
            return

        kite = KiteConnect(api_key=kite_settings.api_key)
        kite.set_access_token(kite_settings.access_token)
        future_quotes = kite.quote(*future_instruments.keys())
        bucket_time = current_bucket_time(now).replace(tzinfo=None)
        saved_count = 0
        option_instruments = {}

        for instrument, selections in future_instruments.items():
            quote = future_quotes.get(instrument)
            if not quote:
                continue

            for contract_month, key, row in selections:
                if save_snapshot(contract_month, key, row, quote, bucket_time):
                    saved_count += 1

                index_level = quote_value(quote, "last_price")
                for option_row in resolve_atm_option_rows(
                    master_contract,
                    CONTRACT_NAMES[key],
                    row["expiry"],
                    index_level,
                ):
                    symbol = option_row["tradingsymbol"]
                    exchange = option_row.get("exchange") or "NFO"
                    option_instruments.setdefault(f"{exchange}:{symbol}", []).append((contract_month, key, option_row))

        if option_instruments:
            option_quotes = kite.quote(*option_instruments.keys())

            for instrument, selections in option_instruments.items():
                quote = option_quotes.get(instrument)
                if not quote:
                    continue

                for contract_month, key, row in selections:
                    if save_snapshot(contract_month, key, row, quote, bucket_time):
                        saved_count += 1

        if saved_count:
            log(f"Saved {saved_count} backend market snapshots.", "INFO")

    except TokenException as e:
        # Do NOT clear the stored access_token automatically. A single
        # TokenException can be a transient Kite-side blip rather than a
        # real expiry, and wiping a freshly-generated token leaves the
        # admin staring at an empty Access Token field with no trace.
        # The admin's "Refresh Zerodha Token" flow overwrites whatever
        # is here, so leaving a stale token in place does not block
        # recovery — it just delays it until the admin notices the
        # dashboard stale banner and re-authenticates.
        log(f"Kite TokenException in recorder (token left in place for admin re-auth): {e}", "ERROR")

    except Exception as e:
        log(f"Error {e} occured while recording market snapshots !", "ERROR")
        traceback.print_exc()

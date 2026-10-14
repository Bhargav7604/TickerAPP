import datetime as dt
import os
import threading
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
from django.conf import settings


CONTRACT_MONTH_INDEX = {
    "current": 0,
    "next": 1,
    "far": 2,
}

CONTRACT_NAMES = {
    "nifty": "NIFTY",
    "banknifty": "BANKNIFTY",
    "sensex": "SENSEX",
}

# Which option expiry to pick for AC/DD ATM analysis per index.
# - "weekly":  use the soonest upcoming option expiry. Right for indices
#              that have an active weekly chain (NIFTY, SENSEX).
# - "monthly": use the option expiry matching the future's monthly date.
#              Right for BANKNIFTY where NSE discontinued weeklies — the
#              near-expiry monthly contract often has sparse strikes that
#              are far from the underlying, so we need the depth of the
#              current monthly future's expiry chain.
INDEX_OPTION_EXPIRY_PREFERENCE = {
    "NIFTY": "weekly",
    "BANKNIFTY": "monthly",
    "SENSEX": "weekly",
}

OPTION_TYPES = ("CE", "PE")
MARKET_TZ = ZoneInfo("Asia/Kolkata")

# A chain whose closest listed strike sits farther than this fraction of
# spot is considered too sparse to use for ATM analysis. The effective
# limit is also capped by the chain's strike spacing so we do not accept a
# nominally "near" strike that is still multiple ATM steps away.
MAX_ATM_DISTANCE_PCT = 0.01
MAX_ATM_STRIKE_STEPS = 1.0

_CACHE_LOCK = threading.Lock()
_CACHE = {
    "mtime_ns": None,
    "frame": None,
}


def master_contract_path():
    return Path(os.environ.get("MASTER_CONTRACT_PATH", Path(settings.BASE_DIR) / "master_contract.csv"))


def clear_master_contract_cache():
    with _CACHE_LOCK:
        _CACHE["mtime_ns"] = None
        _CACHE["frame"] = None


def get_master_contract():
    path = master_contract_path()
    mtime_ns = path.stat().st_mtime_ns

    with _CACHE_LOCK:
        if _CACHE["frame"] is not None and _CACHE["mtime_ns"] == mtime_ns:
            return _CACHE["frame"]

        frame = pd.read_csv(path, parse_dates=["expiry"])
        unnamed_columns = [column for column in frame.columns if str(column).startswith("Unnamed:")]
        if unnamed_columns:
            frame = frame.drop(columns=unnamed_columns)

        _CACHE["mtime_ns"] = mtime_ns
        _CACHE["frame"] = frame
        return frame


def market_today():
    return dt.datetime.now(MARKET_TZ).date()


def contract_to_payload(row):
    expiry = row["expiry"]
    if hasattr(expiry, "date"):
        expiry = expiry.date()

    return {
        "symbol": row["tradingsymbol"],
        "expiry": expiry.isoformat(),
        "lotSize": int(row["lot_size"]),
    }


def max_atm_distance_for_chain(rows, underlying):
    max_distance = underlying * MAX_ATM_DISTANCE_PCT
    strikes = sorted(float(strike) for strike in rows["strike"].dropna().unique())
    strike_gaps = [
        strikes[index] - strikes[index - 1]
        for index in range(1, len(strikes))
        if strikes[index] > strikes[index - 1]
    ]

    if not strike_gaps:
        return max_distance

    return min(max_distance, min(strike_gaps) * MAX_ATM_STRIKE_STEPS)


def resolve_contracts(contract_month):
    month_index = CONTRACT_MONTH_INDEX.get(contract_month, 0)
    master_contract = get_master_contract()
    today = pd.Timestamp(market_today())
    contracts = {}

    for key, name in CONTRACT_NAMES.items():
        rows = master_contract[
            (master_contract["name"] == name) &
            (master_contract["instrument_type"] == "FUT")
        ]

        if rows.empty:
            contracts[key] = None
            continue

        future_rows = rows[rows["expiry"] >= today]
        if not future_rows.empty:
            rows = future_rows

        rows = rows.sort_values(["expiry", "tradingsymbol"])
        expiries = list(rows["expiry"].drop_duplicates())
        selected_expiry = expiries[min(month_index, len(expiries) - 1)]
        selected = rows[rows["expiry"] == selected_expiry].iloc[0]
        contracts[key] = contract_to_payload(selected)

    return contracts


def resolve_contract_rows(master_contract=None):
    master_contract = master_contract if master_contract is not None else get_master_contract()
    today = pd.Timestamp(market_today())
    contract_rows = {}

    for contract_month, month_index in CONTRACT_MONTH_INDEX.items():
        for key, name in CONTRACT_NAMES.items():
            rows = master_contract[
                (master_contract["name"] == name) &
                (master_contract["instrument_type"] == "FUT")
            ]

            if rows.empty:
                continue

            future_rows = rows[rows["expiry"] >= today]
            if not future_rows.empty:
                rows = future_rows

            rows = rows.sort_values(["expiry", "tradingsymbol"])
            expiries = list(rows["expiry"].drop_duplicates())
            selected_expiry = expiries[min(month_index, len(expiries) - 1)]
            contract_rows[(contract_month, key)] = rows[rows["expiry"] == selected_expiry].iloc[0]

    return contract_rows


def resolve_atm_option_rows(master_contract, name, future_expiry, underlying_price):
    if underlying_price is None:
        return []

    option_rows = master_contract[
        (master_contract["name"] == name) &
        (master_contract["instrument_type"].isin(OPTION_TYPES))
    ]

    if option_rows.empty:
        return []

    # Per-index expiry strategy (see INDEX_OPTION_EXPIRY_PREFERENCE):
    # NIFTY / SENSEX pick the nearest upcoming weekly; BANKNIFTY pins to
    # the future's monthly expiry because its weekly chain was retired
    # and the "nearest upcoming" can land on a near-expiry contract whose
    # strike ladder is sparse around the underlying.
    today = pd.Timestamp(market_today())
    upcoming_rows = option_rows[option_rows["expiry"] >= today]

    if upcoming_rows.empty:
        return []

    preference = INDEX_OPTION_EXPIRY_PREFERENCE.get(name, "weekly")
    expiries = sorted(upcoming_rows["expiry"].drop_duplicates())

    if preference == "monthly":
        # Try the future's monthly expiry first, then advance to the next
        # monthly expiries by ascending day distance.
        ranked_expiries = sorted(expiries, key=lambda expiry: abs((expiry - future_expiry).days))
    else:
        # Weekly: try the soonest, then progressively later weeklies.
        ranked_expiries = expiries

    # Walk the ranked expiries and pick the first chain whose closest
    # listed strike is within MAX_ATM_DISTANCE_PCT of underlying. NSE
    # does not always extend strikes upward immediately when spot rallies,
    # so a "nearest" expiry can have a sparse ladder whose ATM lands
    # thousands of points away from spot. Falling through to the next
    # expiry whose ladder actually brackets spot avoids that.
    underlying = float(underlying_price)
    same_expiry_rows = None

    for candidate in ranked_expiries:
        candidate_rows = upcoming_rows[upcoming_rows["expiry"] == candidate].copy()
        candidate_rows["strike_distance"] = (candidate_rows["strike"] - underlying).abs()
        closest_distance = candidate_rows["strike_distance"].min()
        max_distance = max_atm_distance_for_chain(candidate_rows, underlying)

        if closest_distance <= max_distance:
            same_expiry_rows = candidate_rows
            break

    if same_expiry_rows is None:
        # Do not create AC/DD signals from a stale or sparse chain. Showing no
        # option signal is safer than showing a strike that is visibly not ATM.
        return []

    atm_strike = same_expiry_rows.sort_values(["strike_distance", "strike"]).iloc[0]["strike"]
    atm_rows = same_expiry_rows[same_expiry_rows["strike"] == atm_strike]
    selected_rows = []

    for option_type in OPTION_TYPES:
        side_rows = atm_rows[atm_rows["instrument_type"] == option_type].sort_values("tradingsymbol")
        if not side_rows.empty:
            selected_rows.append(side_rows.iloc[0])

    return selected_rows


def instrument_tokens_for_symbols(symbols):
    clean_symbols = [symbol for symbol in symbols if symbol]
    if not clean_symbols:
        return {}, {}

    master_contract = get_master_contract()
    rows = master_contract[master_contract["tradingsymbol"].isin(clean_symbols)]
    lookup = {}

    for _, row in rows.drop_duplicates("tradingsymbol").iterrows():
        lookup[row["tradingsymbol"]] = {
            "token": int(row["instrument_token"]),
            "lot_size": int(row["lot_size"]),
        }

    tokens = {}
    lots = {}
    for symbol in clean_symbols:
        match = lookup.get(symbol)
        tokens[symbol] = match["token"] if match else None
        lots[symbol] = match["lot_size"] if match else None

    return tokens, lots

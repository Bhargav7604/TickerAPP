"""The stocks behind the Market, Money Flow and Intraday pages: NIFTY 500 plus every F&O stock, with daily stats."""
import datetime as dt
import threading
import time

import pandas as pd

from .equity import broker
from .market_contracts import MARKET_TZ, get_master_contract
from .models import IndexConstituent, UniverseStats

FLAG_N500, FLAG_FNO, FLAG_N50, FLAG_SENSEX = 1, 2, 4, 8
# key: (exchange, Kite trading symbol, label shown on the pages)
BOARD_INDICES = {
    "NIFTY": ("NSE", "NIFTY 50", "NIFTY 50"),
    "SENSEX": ("BSE", "SENSEX", "SENSEX"),
    "BANKNIFTY": ("NSE", "NIFTY BANK", "BANK NIFTY"),
    "FINNIFTY": ("NSE", "NIFTY FIN SERVICE", "FIN NIFTY"),
    "MIDCPNIFTY": ("NSE", "NIFTY MID SELECT", "MIDCAP SELECT"),
    "NIFTYNXT50": ("NSE", "NIFTY NEXT 50", "NIFTY NEXT 50"),
    "NIFTY500": ("NSE", "NIFTY 500", "NIFTY 500"),
    "INDIAVIX": ("NSE", "INDIA VIX", "INDIA VIX"),
}
UNIVERSE_TTL = 600
HISTORY_DAYS = 380
RECENT_CANDLES = 6
AVG_VOLUME_SESSIONS = 20
STATS_PAUSE = 0.4  # Kite allows three historical-data requests a second; leave room for the other jobs.
STATS_CALLS_PER_RUN = 1000

_cache = {"at": 0.0, "frame": None, "value": None}
_cache_lock = threading.Lock()


def cash_name(symbol, series):
    """Kite's trading symbol: non-EQ series trade as SYMBOL-SERIES (REITs are RR, trade-for-trade is BE)."""
    return symbol if not series or series == "EQ" else f"{symbol}-{series}"


def nearest_stock_futures(frame, today):
    """{name: row} for each stock's nearest unexpired future."""
    if "stock_derivative" in frame:
        stock = frame["stock_derivative"].eq(True)
    else:
        stock = ~frame["name"].isin(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"])
    futures = frame[stock & frame["exchange"].eq("NFO") & frame["segment"].eq("NFO-FUT")
                    & frame["instrument_type"].eq("FUT") & (frame["expiry"] >= pd.Timestamp(today))]
    return {row["name"]: row for _, row in futures.sort_values("expiry").drop_duplicates("name").iterrows()}


def build_universe(frame, members, today):
    """members: {index_key: {symbol: (company, sector, series)}}. Returns (stocks, indices) sorted by symbol."""
    cash = frame[frame["exchange"].eq("NSE") & frame["segment"].eq("NSE") & frame["instrument_type"].eq("EQ")]
    cash_rows = {row["tradingsymbol"]: row for _, row in cash.iterrows()}
    futures = nearest_stock_futures(frame, today)
    n500 = members.get("nifty500", {})
    large, mid = set(members.get("nifty100", {})), set(members.get("midcap150", {}))
    n50, sensex = set(members.get("nifty", {})), set(members.get("sensex", {}))
    stocks = []
    for symbol in sorted(set(n500) | set(futures)):
        company, sector, series = n500.get(symbol) or ("", "", "EQ")
        row = cash_rows.get(cash_name(symbol, series))
        if row is None:
            continue
        future = futures.get(symbol)
        flags = (FLAG_N500 if symbol in n500 else 0) | (FLAG_FNO if future is not None else 0) \
            | (FLAG_N50 if symbol in n50 else 0) | (FLAG_SENSEX if symbol in sensex else 0)
        stocks.append({
            "symbol": symbol, "company": company or str(row.get("name") or symbol).title(), "sector": sector or "Other",
            "cap": "Large" if symbol in large else "Mid" if symbol in mid else "Small" if symbol in n500 else "",
            "flags": flags, "token": int(row["instrument_token"]), "quoteSymbol": row["tradingsymbol"],
            "fut": None if future is None else {"symbol": future["tradingsymbol"], "token": int(future["instrument_token"]),
                                                "lot": int(future["lot_size"]), "expiry": future["expiry"].date().isoformat()},
        })
    indices = []
    for key, (exchange, tradingsymbol, label) in BOARD_INDICES.items():
        rows = frame[frame["exchange"].eq(exchange) & frame["segment"].eq("INDICES") & frame["tradingsymbol"].eq(tradingsymbol)]
        if not rows.empty:
            indices.append({"key": key, "label": label, "name": tradingsymbol, "token": int(rows.iloc[0]["instrument_token"])})
    return stocks, indices


def constituent_members():
    members = {}
    for member in IndexConstituent.objects.filter(index_key__in=["nifty500", "nifty100", "midcap150", "nifty", "sensex"]):
        members.setdefault(member.index_key, {})[member.symbol] = (member.company, member.sector, member.series)
    return members


def universe(now=None):
    """Cached (stocks, indices); rebuilt every ten minutes or when the master contract file changes."""
    now = now or dt.datetime.now(MARKET_TZ)
    frame = get_master_contract()
    with _cache_lock:
        if _cache["value"] is not None and _cache["frame"] is frame and time.time() - _cache["at"] < UNIVERSE_TTL:
            return _cache["value"]
    value = build_universe(frame, constituent_members(), now.date())
    with _cache_lock:
        _cache.update(at=time.time(), frame=frame, value=value)
    return value


def clear_universe_cache():
    with _cache_lock:
        _cache.update(at=0.0, frame=None, value=None)


def summarise_candles(candles, today):
    """candles: Kite daily rows oldest first -> the fields kept in UniverseStats. Today's unfinished candle stays out of the stats."""
    rows = [[row["date"].date().isoformat() if hasattr(row["date"], "date") else str(row["date"])[:10],
             row["open"], row["high"], row["low"], row["close"], row.get("volume") or 0] for row in candles]
    done = [row for row in rows if row[0] < today.isoformat()]
    if not done:
        return {"recent": rows[-RECENT_CANDLES:], "high_52w": None, "low_52w": None, "avg_volume": None}
    volumes = [row[5] for row in done[-AVG_VOLUME_SESSIONS:] if row[5]]
    return {"recent": rows[-RECENT_CANDLES:], "high_52w": max(row[2] for row in done), "low_52w": min(row[3] for row in done),
            "avg_volume": sum(volumes) / len(volumes) if volumes else None}


def previous_candle(recent, session):
    """The last complete daily candle before the session being shown: [date, open, high, low, close, volume] or None."""
    before = [row for row in recent or [] if row[0] < session.isoformat()]
    return before[-1] if before else None


def previous_oi(fut_oi, session):
    dates = sorted(date for date in (fut_oi or {}) if date < session.isoformat())
    return fut_oi[dates[-1]] if dates else None


def refresh_universe_stats(client=None, now=None, max_calls=STATS_CALLS_PER_RUN, pause=STATS_PAUSE):
    """Fetch a year of daily candles (and recent futures OI) for every stock and index not done today."""
    now = now or dt.datetime.now(MARKET_TZ)
    today = now.date()
    if client is None:
        client, _ = broker()
        if not client:
            return 0
    stocks, indices = universe(now)
    targets = [(stock["symbol"], stock["token"], stock["fut"]) for stock in stocks] \
        + [(index["name"], index["token"], None) for index in indices]
    fresh = set(UniverseStats.objects.filter(stats_on=today).values_list("symbol", flat=True))
    start = dt.datetime.combine(today - dt.timedelta(days=HISTORY_DAYS), dt.time.min)
    end = now.replace(tzinfo=None)
    calls = saved = 0
    for symbol, token, future in targets:
        if symbol in fresh:
            continue
        if calls + (2 if future else 1) > max_calls:
            break
        try:
            candles = client.historical_data(token, start, end, "day")
            calls += 1
            time.sleep(pause)
            fut_oi = {}
            if future:
                rows = client.historical_data(future["token"], end - dt.timedelta(days=12), end, "day", oi=True)
                calls += 1
                time.sleep(pause)
                fut_oi = {row["date"].date().isoformat(): row["oi"] for row in rows if row.get("oi")}
        except Exception as exc:
            if type(exc).__name__ in ("TokenException", "PermissionException"):
                break  # the Zerodha session has expired; try again after the next login
            continue
        UniverseStats.objects.update_or_create(symbol=symbol, defaults={
            "stats_on": today, **summarise_candles(candles, today), "fut_symbol": future["symbol"] if future else "", "fut_oi": fut_oi})
        saved += 1
    return saved

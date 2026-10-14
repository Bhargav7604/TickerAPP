"""Read-only stock derivatives and index options, with separate catalogues."""
import datetime as dt
import hashlib
import math
import re
import time
import uuid
from zoneinfo import ZoneInfo

import pandas as pd
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from kiteconnect import KiteConnect

from .market_contracts import get_master_contract, market_today
from .models import KiteSettings, LiveMarketFeed
from .views import protected

IST = ZoneInfo("Asia/Kolkata")
MAX_CONTRACTS = 50
# Row 1 belongs exclusively to the index WebSocket worker. These two rows are
# bounded, shared REST caches; their leases enforce broker rate limits across workers.
QUOTE_CACHE_ID = 2
HISTORY_CACHE_ID = 3
INDEX_OPTION_EXCHANGES = {"NIFTY": "NFO", "BANKNIFTY": "NFO", "SENSEX": "BFO"}


def stock_derivative_mask(frame):
    cash_symbols = set(frame.loc[
        (frame["exchange"] == "NSE") & (frame["instrument_type"] == "EQ"), "tradingsymbol"
    ])
    return (
        (frame["exchange"] == "NFO")
        & frame["segment"].isin(["NFO-FUT", "NFO-OPT"])
        & frame["instrument_type"].isin(["FUT", "CE", "PE"])
        & frame["name"].isin(cash_symbols)
    )


def catalogue(index_options=False):
    frame = get_master_contract()
    if index_options:
        return frame[
            frame["name"].isin(INDEX_OPTION_EXCHANGES)
            & frame["exchange"].eq(frame["name"].map(INDEX_OPTION_EXCHANGES))
            & frame["segment"].eq(frame["exchange"] + "-OPT")
            & frame["instrument_type"].isin(["CE", "PE"])
            & (frame["expiry"] >= pd.Timestamp(market_today()))
            & (frame["lot_size"] > 0)
        ]
    if "stock_derivative" not in frame:
        return frame.iloc[0:0]
    return frame[
        frame["stock_derivative"].eq(True)
        & frame["exchange"].eq("NFO")
        & frame["segment"].isin(["NFO-FUT", "NFO-OPT"])
        & frame["instrument_type"].isin(["FUT", "CE", "PE"])
        & (frame["expiry"] >= pd.Timestamp(market_today()))
        & (frame["lot_size"] > 0)
    ]


def contract(row):
    return {
        "id": row["exchange"] + ":" + row["tradingsymbol"], "symbol": row["tradingsymbol"],
        "underlying": row["name"], "kind": row["instrument_type"],
        "expiry": row["expiry"].date().isoformat(), "strike": float(row["strike"]),
        "lotSize": int(row["lot_size"]), "tickSize": float(row["tick_size"]),
    }


def read_ids(request):
    ids = list(dict.fromkeys(filter(None, request.GET.get("ids", "").split(","))))
    if len(ids) > MAX_CONTRACTS or any(len(value) > 100 for value in ids):
        raise ValueError("Select no more than 50 contracts.")
    return ids


def selected_rows(ids, index_options=False):
    frame = catalogue(index_options)
    rows = frame[(frame["exchange"] + ":" + frame["tradingsymbol"]).isin(ids)]
    if len(rows) != len(ids):
        raise ValueError("A contract is expired or unavailable. Refresh the contract list.")
    return rows


def failure(message, status=400):
    return JsonResponse({"type": "error", "message": message}, status=status)


def option_contracts(rows, params, index_options=False):
    rows = rows[rows["instrument_type"].isin(["CE", "PE"])]
    stocks = sorted(rows["name"].unique().tolist())
    if index_options:
        stocks = [name for name in INDEX_OPTION_EXCHANGES if name in stocks]
    default = "NIFTY" if index_options else "RELIANCE"
    subject = "index" if index_options else "stock"
    underlying = params.get("underlying") or (default if default in stocks else next(iter(stocks), ""))
    if underlying and underlying not in stocks:
        raise ValueError(f"Select an available {subject}.")
    rows = rows[rows["name"].eq(underlying)]
    expiries = sorted(rows["expiry"].dt.strftime("%Y-%m-%d").unique().tolist())
    expiry = params.get("expiry") or next(iter(expiries), "")
    if expiry and expiry not in expiries:
        raise ValueError(f"Select an available expiry for this {subject}.")
    rows = rows[rows["expiry"].dt.strftime("%Y-%m-%d").eq(expiry)]
    strikes = sorted(float(value) for value in rows["strike"].unique())
    strike = params.get("strike", "")
    if strike != "":
        strike = float(strike)
        if strike not in strikes:
            raise ValueError("Select an available strike for this expiry.")
        rows = rows[rows["strike"].eq(strike)]
    side = params.get("option_type", "all")
    if side not in ("all", "CE", "PE"):
        raise ValueError("Invalid option type.")
    if side != "all":
        rows = rows[rows["instrument_type"].eq(side)]
    page = int(params.get("page", "0"))
    if page < 0 or page > 10000:
        raise ValueError("Invalid options page.")
    rows = rows.sort_values(["strike", "instrument_type"])
    return JsonResponse({"type": "success", "contracts": [contract(row) for _, row in rows.iloc[page * 49:(page + 1) * 49].iterrows()],
                         "total": len(rows), "asOf": market_today().isoformat(),
                         "filters": {"indices" if index_options else "stocks": stocks, "expiries": expiries, "strikes": strikes,
                                     "underlying": underlying, "expiry": expiry, "strike": strike}})


@never_cache
@require_GET
def contracts(request, index_options=False):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        rows = catalogue(index_options)
        ids = read_ids(request)
        if ids:
            rows = rows[(rows["exchange"] + ":" + rows["tradingsymbol"]).isin(ids)]
        else:
            kind = request.GET.get("kind", "options" if index_options else "FUT")
            if kind == "options":
                return option_contracts(rows, request.GET, index_options)
            if index_options and kind == "FUT":
                raise ValueError("Only index options are available in this view.")
            if kind not in ("FUT", "CE", "PE", "all"):
                raise ValueError("Invalid contract type.")
            if kind != "all":
                rows = rows[rows["instrument_type"].eq(kind)]
            query = re.sub(r"(?<=\d),(?=\d)", "", request.GET.get("q", "").strip().upper()[:80])
            search = rows["name"] + " " + rows["tradingsymbol"] + " " + rows["instrument_type"] + " " + rows["strike"].astype(str)
            for word in query.split():
                rows = rows[rows["instrument_type"].eq(word)] if word in ("FUT", "CE", "PE") else rows[search.loc[rows.index].str.contains(word, regex=False, na=False)]
        rows = rows.sort_values(["name", "expiry", "strike", "instrument_type"])
        total = len(rows)
        limit = 1000 if not index_options and request.GET.get("kind", "FUT") == "FUT" else 50
        return JsonResponse({"type": "success", "contracts": [contract(row) for _, row in rows.head(limit).iterrows()],
                             "total": total, "asOf": market_today().isoformat(),
                             "message": "" if total else "No matching contracts. The daily instrument catalogue may need refreshing."})
    except ValueError as exc:
        return failure(str(exc))
    except (OSError, KeyError):
        return failure("Instrument catalogue unavailable. Ask the administrator to refresh it.", 503)


def number(value):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None


def timestamp(value):
    if not isinstance(value, dt.datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=IST)
    return value.isoformat()


def quote_payload(raw, lot_size):
    ltp = number(raw.get("last_price"))
    ohlc = {key: number(raw.get("ohlc", {}).get(key)) for key in ("open", "high", "low", "close")}
    close = ohlc["close"]
    depth = {}
    for side in ("buy", "sell"):
        depth[side] = [{"price": number(level.get("price")),
                        "lots": number(level.get("quantity")) / lot_size}
                       for level in raw.get("depth", {}).get(side, [])[:5]
                       if number(level.get("quantity")) is not None and (number(level.get("price")) or 0) > 0]
    return {
        "ltp": ltp, "change": (ltp - close) if close and ltp is not None else None,
        "changePct": (ltp / close - 1) * 100 if close and ltp is not None else None,
        "volumeLots": number(raw.get("volume")) / lot_size if number(raw.get("volume")) is not None else None,
        "oiLots": number(raw.get("oi")) / lot_size if number(raw.get("oi")) is not None else None,
        "bid": depth["buy"][0]["price"] if depth["buy"] else None,
        "ask": depth["sell"][0]["price"] if depth["sell"] else None,
        "depth": depth, "ohlc": ohlc, "vwap": number(raw.get("average_price")),
        "quotedAt": timestamp(raw.get("timestamp")), "lastTradeAt": timestamp(raw.get("last_trade_time")),
    }


def broker():
    credentials = KiteSettings.objects.order_by("-updated_at", "-id").first()
    if not credentials or not credentials.api_key or not credentials.access_token:
        return None, None
    session = hashlib.sha256((credentials.api_key + ":" + credentials.access_token).encode()).hexdigest()
    client = KiteConnect(api_key=credentials.api_key, access_token=credentials.access_token, timeout=8)
    return client, session


def cached_broker_result(cache_id, session, keys, ttl, fetch):
    """One fetch at a time, with a cross-worker cooldown and bounded retention."""
    now = time.time()
    state, _ = LiveMarketFeed.objects.get_or_create(pk=cache_id)
    entries = state.payload.get("entries", {}) if state.payload.get("session") == session else {}
    entries = {key: value for key, value in entries.items() if now - value["at"] < 600}
    missing = [key for key in keys if key not in entries or now - entries[key]["at"] >= ttl]
    if missing:
        owner = uuid.uuid4().hex
        acquired = LiveMarketFeed.objects.filter(pk=cache_id, lease_until__lt=now).update(owner=owner, lease_until=now + 15)
        if acquired:
            try:
                # Another worker may have populated entries since our initial read.
                state.refresh_from_db()
                entries = state.payload.get("entries", {}) if state.payload.get("session") == session else {}
                entries = {key: value for key, value in entries.items() if now - value["at"] < 600}
                missing = [key for key in keys if key not in entries or now - entries[key]["at"] >= ttl]
                values = fetch(missing) if missing else {}
                fetched_at = time.time()
                for key in missing:
                    # An omitted broker quote is deliberately not replaced with an old value.
                    entries[key] = {"at": fetched_at, "data": values.get(key)}
                entries = dict(sorted(entries.items(), key=lambda item: item[1]["at"], reverse=True)[:500])
                LiveMarketFeed.objects.filter(pk=cache_id, owner=owner).update(
                    payload={"session": session, "entries": entries}, lease_until=time.time() + 1.1, updated_at=timezone.now())
            except Exception:
                LiveMarketFeed.objects.filter(pk=cache_id, owner=owner).update(lease_until=time.time() + 5)
                raise
    return {key: value for key, value in entries.items() if key in keys}


def cache_retry_ms(cache_id, entries, keys, ttl):
    if all(key in entries and time.time() - entries[key]["at"] < ttl for key in keys):
        return None
    lease = LiveMarketFeed.objects.values_list("lease_until", flat=True).get(pk=cache_id)
    # Poll an in-flight lease promptly; do not make the browser wait its full timeout.
    return max(250, min(1500, math.ceil((lease - time.time()) * 1000)))


@never_cache
@require_GET
def quotes(request, index_options=False):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        ids = read_ids(request)
        if not ids:
            return JsonResponse({"type": "success", "quotes": {}, "status": "empty"})
        rows = selected_rows(ids, index_options)
        client, session = broker()
        if not client:
            return JsonResponse({"type": "success", "quotes": {}, "status": "offline", "message": "Zerodha session is not connected. Refresh it in admin."})
        lots = {row["exchange"] + ":" + row["tradingsymbol"]: int(row["lot_size"]) for _, row in rows.iterrows()}
        def fetch(missing):
            raw = client.quote(missing)
            return {key: quote_payload(value, lots[key]) for key, value in raw.items() if key in lots}
        entries = cached_broker_result(QUOTE_CACHE_ID, session, ids, 3, fetch)
        data = {key: {**value["data"], "fetchedAt": value["at"], "stale": time.time() - value["at"] > 15}
                for key, value in entries.items() if value["data"] is not None}
        retry = cache_retry_ms(QUOTE_CACHE_ID, entries, ids, 3)
        unavailable = [key for key, value in entries.items() if value["data"] is None]
        return JsonResponse({"type": "success", "quotes": data, "status": "waiting" if retry else "ready",
                             "retryAfterMs": retry, "unavailableIds": unavailable})
    except ValueError as exc:
        return failure(str(exc))
    except Exception:
        return failure("Quotes unavailable. Check the broker session and market-data access in admin.", 503)


@never_cache
@require_GET
def history(request, index_options=False):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        ids = read_ids(request)
        if len(ids) != 1:
            raise ValueError("Select one contract for the chart.")
        row = selected_rows(ids, index_options).iloc[0]
        client, session = broker()
        if not client:
            return JsonResponse({"type": "success", "candles": [], "message": "Connect Zerodha to load the chart."})
        now = dt.datetime.now(IST)
        start = now.replace(hour=9, minute=15, second=0, microsecond=0)
        end = min(now, now.replace(hour=15, minute=30, second=0, microsecond=0))
        if end < start or now.weekday() >= 5:
            return JsonResponse({"type": "success", "candles": [], "message": "No candles for today's session yet."})
        key = ids[0] + ":ohlc:" + now.date().isoformat()
        def fetch(_):
            candles = client.historical_data(int(row["instrument_token"]), start, end, "5minute", oi=True)
            return {key: [{"time": int(candle["date"].timestamp()), "close": number(candle.get("close")),
                           "open": number(candle.get("open")), "high": number(candle.get("high")),
                           "low": number(candle.get("low")),
                           "volume": number(candle.get("volume")) / int(row["lot_size"])}
                          for candle in candles if number(candle.get("close")) is not None and number(candle.get("volume")) is not None]}
        entries = cached_broker_result(HISTORY_CACHE_ID, session, [key], 60, fetch)
        return JsonResponse({"type": "success", "candles": entries.get(key, {}).get("data") or [],
                             "retryAfterMs": cache_retry_ms(HISTORY_CACHE_ID, entries, [key], 60),
                             "message": "" if key in entries else "Loading chart. Please wait."})
    except ValueError as exc:
        return failure(str(exc))
    except Exception:
        return failure("Chart unavailable. Historical-data access or a fresh broker session may be required.", 503)

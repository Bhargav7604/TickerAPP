import jwt
import json
import secrets
import traceback
import datetime as dt
from zoneinfo import ZoneInfo
from .logger import log
# from alice_blue import AliceBlue
from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.db import connection as db_connection
from kiteconnect import KiteConnect
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.cache import never_cache
from django.utils import timezone
from django.contrib.auth.hashers import make_password

# Models
from .models import KiteSettings, LiveMarketFeed, MarketSnapshot, SMTPSettings, User
from .market_contracts import (
    CONTRACT_MONTH_INDEX,
    CONTRACT_NAMES,
    get_master_contract,
    instrument_tokens_for_symbols,
    resolve_contracts,
)
from . import acdd_analyzer
from .instruments import resolve_spot_tokens


@require_http_methods(["GET"])
def health(request):
    # Liveness/readiness probe — returns 200 if the DB is reachable, 503 otherwise.
    # Cheap enough for nginx upstream healthchecks or external uptime monitors.
    try:
        db_connection.ensure_connection()
        return JsonResponse({"status": "ok", "db": True}, status=200)
    except Exception as e:
        return JsonResponse({"status": "db_unavailable", "db": False, "error": repr(e)}, status=503)

DEFAULT_ALERT_LOT_THRESHOLDS = {"nifty": 400.0, "banknifty": 400.0, "sensex": 40.0}
ALERT_THRESHOLD_FIELDS = {
    "nifty": "alert_lot_threshold",
    "banknifty": "banknifty_alert_lot_threshold",
    "sensex": "sensex_alert_lot_threshold",
}
SNAPSHOT_INDEX_KEYS = set(CONTRACT_NAMES.keys())
MARKET_TZ = ZoneInfo("Asia/Kolkata")
MARKET_OPEN_MINUTES = 9 * 60
MARKET_CLOSE_MINUTES = (15 * 60) + 30
SNAPSHOT_INTERVAL_MINUTES = 5
HEARTBEAT_DELAYED_SECONDS = 7 * 60
HEARTBEAT_STALE_SECONDS = 12 * 60


def apply_contract_month(user, contract_month=None, extra_update_fields=None):
    update_fields = []
    next_contract_month = contract_month or user.contract_month or "current"
    if next_contract_month not in CONTRACT_MONTH_INDEX:
        next_contract_month = "current"

    if user.contract_month != next_contract_month:
        user.contract_month = next_contract_month
        update_fields.append("contract_month")

    contracts = resolve_contracts(user.contract_month)

    for key, field_name in (
        ("nifty", "nifty_expiry"),
        ("banknifty", "banknifty_expiry"),
        ("sensex", "sensex_expiry"),
    ):
        contract = contracts.get(key)
        if contract and str(getattr(user, field_name)) != contract["expiry"]:
            setattr(user, field_name, contract["expiry"])
            update_fields.append(field_name)

    update_fields.extend(extra_update_fields or [])
    if update_fields:
        user.save(update_fields=list(dict.fromkeys(update_fields)))

    return contracts


def alert_lot_thresholds(user):
    return {
        key: getattr(user, field) or DEFAULT_ALERT_LOT_THRESHOLDS[key]
        for key, field in ALERT_THRESHOLD_FIELDS.items()
    }


def user_settings_payload(user, contracts=None):
    contracts = contracts or resolve_contracts(user.contract_month)
    thresholds = alert_lot_thresholds(user)

    return {
        "contractMonth": user.contract_month,
        "marketColumns": user.market_columns,
        "niftyExpiry": user.nifty_expiry,
        "bankniftyExpiry": user.banknifty_expiry,
        "sensexExpiry": user.sensex_expiry,
        "alertsEnabled": user.alerts_enabled,
        "alertEmail": user.alert_email,
        "alertLotThreshold": thresholds["nifty"],
        "alertLotThresholds": thresholds,
        "symbols": contracts,
    }


def get_enabled_smtp_settings():
    return SMTPSettings.objects.filter(enabled=True).order_by("-updated_at", "-id").first()


def get_kite_credentials(user=None):
    kite_settings = KiteSettings.objects.order_by("-updated_at", "-id").first()

    api_key = kite_settings.api_key.strip() if kite_settings else ""
    api_secret = kite_settings.api_secret.strip() if kite_settings else ""
    access_token = kite_settings.access_token.strip() if kite_settings else ""

    if user:
        api_key = api_key or user.broker_api_key.strip()
        api_secret = api_secret or user.broker_api_secret.strip()
        access_token = access_token or user.broker_access_token.strip()

    return kite_settings, api_key, api_secret, access_token


def parse_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def user_validity_error(user):
    if user.valid_until and user.valid_until < dt.datetime.now(MARKET_TZ).date():
        return JsonResponse({
            "type": "UserException",
            "message": "User validity expired. Contact admin.",
        }, status=400)

    return None


def parse_snapshot_time(value):
    try:
        timestamp = float(value) / 1000
        return dt.datetime.fromtimestamp(timestamp, MARKET_TZ).replace(tzinfo=None)
    except (TypeError, ValueError, OSError):
        return None


def market_timestamp_ms(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=MARKET_TZ)
    else:
        value = value.astimezone(MARKET_TZ)

    return int(value.timestamp() * 1000)


def get_market_minutes(value):
    return (value.hour * 60) + value.minute


def is_market_open(value):
    minutes = get_market_minutes(value)
    return value.weekday() < 5 and MARKET_OPEN_MINUTES <= minutes <= MARKET_CLOSE_MINUTES


def snapshot_payload(snapshot):
    bucket_time = snapshot.bucket_time

    payload = {
        "time": market_timestamp_ms(bucket_time),
        "symbol": snapshot.symbol,
        "contractMonth": snapshot.contract_month,
        "instrumentType": snapshot.instrument_type,
        "strike": snapshot.strike,
        "indexLevel": snapshot.index_level,
        "netLots": snapshot.net_lots,
    }

    if snapshot.demand_supply_ratio is not None:
        payload["ratio"] = snapshot.demand_supply_ratio

    if snapshot.volume_traded is not None:
        payload["volumeTraded"] = snapshot.volume_traded

    if snapshot.interval_volume is not None:
        payload["intervalVolume"] = snapshot.interval_volume

    if snapshot.vwap is not None:
        payload["vwap"] = snapshot.vwap

    return payload


def empty_snapshot_history():
    return {key: [] for key in CONTRACT_NAMES.keys()}


def today_snapshot_bounds():
    today = dt.datetime.now(MARKET_TZ).date()
    start = dt.datetime.combine(today, dt.time.min)
    end = start + dt.timedelta(days=1)
    return start, end


def protected(request):
    authorization = request.headers.get("Authorization", "")
    token_string = authorization.split()

    if len(token_string) != 2:
        return JsonResponse({"type": "TokenException", "message": "Invalid Token"}, status=400)

    if token_string[0] != "jwt-token":
        return JsonResponse({"type": "TokenException", "message": "Invalid Token"}, status=400)

    token = bytes(token_string[1], "utf-8")

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])

    except (jwt.exceptions.ExpiredSignatureError, jwt.exceptions.InvalidSignatureError, jwt.exceptions.DecodeError):
        return JsonResponse({"type": "TokenException", "message": "Invalid Token"}, status=400)

    try:
        lookup_fields = (
            "id",
            "username",
            "password",
            "active_session_token",
            "valid_until",
        )

        user = User.objects.only(*lookup_fields).get(id=payload["userId"], username=payload["username"])

    except (KeyError, TypeError, ValueError, User.DoesNotExist):
        return JsonResponse({"type": "UserException", "message": "Invalid Username"}, status=400)

    validity_error = user_validity_error(user)
    if validity_error:
        return validity_error

    if not payload.get("sessionToken") or payload["sessionToken"] != user.active_session_token:
        return JsonResponse({"type": "TokenException", "message": "Logged in from another session"}, status=400)

    return [payload, user]


@csrf_exempt
@require_http_methods(["POST"])
def login_view(request):
    try:
        data = json.loads(request.body)

        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))

        if not username or not password:
            return JsonResponse({"type": "UserException", "message": "Invalid Credentials"}, status=400)

        try:
            user = User.objects.get(username=username)

        except User.DoesNotExist:
            make_password(password)
            return JsonResponse({"type": "UserException", "message": "Invalid Credentials"})

        if not user.check_password(password):
            return JsonResponse({"type": "UserException", "message": "Invalid Credentials"}, status=400)

        validity_error = user_validity_error(user)
        if validity_error:
            return validity_error

        session_token = secrets.token_urlsafe(32)
        user.active_session_token = session_token
        user.save(update_fields=["active_session_token"])

        key = settings.SECRET_KEY
        payload = {
            "userId": user.id,
            "username": username,
            "sessionToken": session_token,
            "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=5)
        }

        token = jwt.encode(payload, key, algorithm="HS256")

        return JsonResponse({"type": "success", "jwtToken": token, "message": "Logged in !"}, status=200)

    except Exception as e:
        traceback.print_exc()
        log(f"Error {e} occured while trying to log the user in !", "ERROR")

        return JsonResponse({"type": "ServerError", "message": "Server Error occured while trying to log in !"}, status=500)


@require_http_methods(["GET"])
def current_user(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    else:
        try:
            user = res[1]
            return JsonResponse({"type": "success", "message": "Valid User !", "username": user.username}, status=200)

        except Exception as e:
            traceback.print_exc()
            log(f"Error {e} occured while fetching the current user !", "ERROR")

            return JsonResponse({"type": "ServerError", "message": "Server Error occured while fetching the current user !"}, status=500)


@require_http_methods(["GET"])
def broker_token(request):
    res = protected(request)
    if isinstance(res, JsonResponse):
        return res
    return JsonResponse({"type": "info", "message": "Market data is provided by the server."})


@csrf_exempt
@require_http_methods(["POST"])
def set_access_token(request):
    return JsonResponse({"type": "Forbidden", "message": "Refresh the broker session from admin."}, status=403)


@never_cache
@require_http_methods(["GET"])
def market_data(request):
    res = protected(request)
    if isinstance(res, JsonResponse):
        return res
    month = request.GET.get("contractMonth", res[1].contract_month)
    if month not in CONTRACT_MONTH_INDEX:
        return JsonResponse({"type": "error", "message": "Invalid contract month."}, status=400)
    state = LiveMarketFeed.objects.filter(pk=1).first()
    payload = state.payload if state else {}
    fresh = bool(state and (timezone.now() - state.updated_at).total_seconds() < 10)
    status = payload.get("status", "offline") if fresh else "offline"
    symbols = payload.get("contracts", {}).get(month, {})
    ticks = payload.get("ticks", {}) if status == "live" else {}
    quotes = {}
    spots = {}
    for key in CONTRACT_NAMES:
        contract = symbols.get(key) or {}
        tick = ticks.get(str(contract.get("token")))
        if tick:
            quotes[key] = tick
        spot_tick = ticks.get(str(payload.get("spotTokens", {}).get(key)), {})
        spots[key] = spot_tick.get("last_price")
    return JsonResponse({
        "type": "success",
        "contractMonth": month,
        "feedStatus": status,
        "symbols": symbols,
        "quotes": quotes,
        "spotPrices": spots,
    })


@require_http_methods(["GET"])
def get_ins_token(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    else:
        try:
            ins_list = request.GET.get("instruments", "").split()
            tokens, lots = instrument_tokens_for_symbols(ins_list)

            return JsonResponse({
                "type": "success",
                "message": "Fetched Tokens from Master Contract !",
                "tokens": tokens,
                "lots": lots,
                "spotTokens": resolve_spot_tokens(get_master_contract()),
            }, status=200)

        except Exception as e:
            traceback.print_exc()
            log(f"Error {e} occured while fetching the instrument tokens !", "ERROR")

            return JsonResponse({"type": "ServerError", "message": "Server Error occured while fetching the instrument tokens !"}, status=500)


@require_http_methods(["GET"])
def get_snapshots(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    try:
        start, end = today_snapshot_bounds()
        snapshots = MarketSnapshot.objects.filter(
            bucket_time__gte=start,
            bucket_time__lt=end,
        ).order_by("bucket_time", "index_key")
        history = empty_snapshot_history()

        for snapshot in snapshots:
            if snapshot.index_key not in history:
                continue

            history[snapshot.index_key].append(snapshot_payload(snapshot))

        return JsonResponse({
            "type": "success",
            "message": "Fetched market snapshots.",
            "chartHistory": history,
        }, status=200)

    except Exception as e:
        traceback.print_exc()
        log(f"Error {e} occured while fetching market snapshots !", "ERROR")

        return JsonResponse({"type": "ServerError", "message": "Server Error occured while fetching market snapshots !"}, status=500)


@require_http_methods(["GET"])
def snapshot_heartbeat(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    try:
        now = dt.datetime.now(MARKET_TZ)
        start, end = today_snapshot_bounds()
        latest_snapshot = MarketSnapshot.objects.filter(
            bucket_time__gte=start,
            bucket_time__lt=end,
        ).order_by("-bucket_time").first()
        latest_time = latest_snapshot.bucket_time if latest_snapshot else None
        market_open = is_market_open(now)
        status = "waiting"
        label = "Waiting"
        age_seconds = None

        if not market_open:
            status = "closed"
            label = "Market closed"
        elif latest_time is None:
            status = "stale"
            label = "Stale"
        else:
            latest_market_time = latest_time.replace(tzinfo=MARKET_TZ) if latest_time.tzinfo is None else latest_time.astimezone(MARKET_TZ)
            age_seconds = max(0, int((now - latest_market_time).total_seconds()))

            if age_seconds > HEARTBEAT_STALE_SECONDS:
                status = "stale"
                label = "Stale"
            elif age_seconds > HEARTBEAT_DELAYED_SECONDS:
                status = "delayed"
                label = "Delayed"
            else:
                status = "live"
                label = "Live"

        return JsonResponse({
            "type": "success",
            "message": "Fetched snapshot heartbeat.",
            "heartbeat": {
                "status": status,
                "label": label,
                "marketOpen": market_open,
                "serverTime": market_timestamp_ms(now),
                "latestSnapshotTime": market_timestamp_ms(latest_time) if latest_time else None,
                "ageSeconds": age_seconds,
                "delayedAfterSeconds": HEARTBEAT_DELAYED_SECONDS,
                "staleAfterSeconds": HEARTBEAT_STALE_SECONDS,
                "intervalMinutes": SNAPSHOT_INTERVAL_MINUTES,
            },
        }, status=200)

    except Exception as e:
        traceback.print_exc()
        log(f"Error {e} occured while fetching snapshot heartbeat !", "ERROR")

        return JsonResponse({"type": "ServerError", "message": "Server Error occured while fetching snapshot heartbeat !"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def save_snapshots(request):
    return JsonResponse({"type": "Forbidden", "message": "Market history is recorded by the server only."}, status=403)


@require_http_methods(["GET"])
def get_settings(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    else:
        try:
            user = res[1]
            contracts = apply_contract_month(user)
            settings = user_settings_payload(user, contracts)

            return JsonResponse({"type": "success", "message": "Fetched Settings Successfully !", "settings": settings}, status=200)

        except Exception as e:
            traceback.print_exc()
            log(f"Error {e} occured while fetching the settings !", "ERROR")

            return JsonResponse({"type": "ServerError", "message": "Server Error occured while fetching the settings !"}, status=500)


MARKET_COLUMN_IDS = (
    "futures", "spot", "difference", "netLots", "ratio", "vwap",
    "lotSize", "oi", "demandSupply", "ohlc", "oiRange", "change",
)


@csrf_exempt
@require_http_methods(["POST"])
def save_market_columns(request):
    res = protected(request)
    if isinstance(res, JsonResponse):
        return res
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"type": "error", "message": "Invalid column selection."}, status=400)
    columns = body.get("marketColumns") if isinstance(body, dict) else None
    if (not isinstance(columns, list) or not columns or len(columns) > len(MARKET_COLUMN_IDS)
            or any(not isinstance(column, str) or column not in MARKET_COLUMN_IDS for column in columns)):
        return JsonResponse({"type": "error", "message": "Select at least one valid market metric."}, status=400)
    user = res[1]
    user.market_columns = list(dict.fromkeys(columns))
    user.save(update_fields=["market_columns"])
    return JsonResponse({"type": "success", "message": "Columns saved.", "marketColumns": user.market_columns})


@csrf_exempt
@require_http_methods(["POST"])
def save_settings(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    else:
        try:
            body = json.loads(request.body)
            user = res[1]
            contract_month = body.get("contractMonth", "current")
            alerts_enabled = bool(body.get("alertsEnabled", False))
            alert_email = body.get("alertEmail", "").strip()
            current_thresholds = alert_lot_thresholds(user)
            requested_thresholds = body.get("alertLotThresholds")
            if not isinstance(requested_thresholds, dict):
                # Older clients only send the single (NIFTY) threshold.
                requested_thresholds = {"nifty": body.get("alertLotThreshold")}
            thresholds = {}
            for key, current in current_thresholds.items():
                value = parse_float(requested_thresholds.get(key), current)
                thresholds[key] = DEFAULT_ALERT_LOT_THRESHOLDS[key] if value < 0 else value

            if alerts_enabled and any(value <= 0 for value in thresholds.values()):
                return JsonResponse({"type": "error", "message": "Alert lot thresholds must be greater than 0."}, status=400)

            user.alerts_enabled = alerts_enabled
            user.alert_email = alert_email
            for key, field in ALERT_THRESHOLD_FIELDS.items():
                setattr(user, field, thresholds[key])

            contracts = apply_contract_month(
                user,
                contract_month,
                extra_update_fields=["alerts_enabled", "alert_email", *ALERT_THRESHOLD_FIELDS.values()],
            )
            settings = user_settings_payload(user, contracts)

            return JsonResponse({"type": "success", "message": "Saved Settings Successfully !", "settings": settings}, status=200)

        except Exception as e:
            traceback.print_exc()
            log(f"Error {e} occured while saving the Settings !", "ERROR")

            return JsonResponse({"type": "ServerError", "message": "Server Error occured while saving the settings !"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def send_lot_swing_alert(request):
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    try:
        user = res[1]
        body = json.loads(request.body)

        if not user.alerts_enabled:
            return JsonResponse({"type": "info", "message": "Alerts are disabled."}, status=200)

        index_key = str(body.get("indexKey") or body.get("indexName", "nifty")).lower()
        if index_key not in ALERT_THRESHOLD_FIELDS:
            index_key = "nifty"
        threshold = parse_float(alert_lot_thresholds(user)[index_key], 0.0)
        swing_lots = parse_float(body.get("swingLots"), 0.0)
        abs_swing_lots = abs(swing_lots)

        if threshold <= 0:
            return JsonResponse({"type": "AlertConfigError", "message": "Alert lot threshold is missing."}, status=400)

        if abs_swing_lots < threshold:
            return JsonResponse({"type": "info", "message": "Lot swing is below alert threshold."}, status=200)

        if not user.alert_email:
            return JsonResponse({"type": "info", "message": "On-screen alert only. Alert email is not configured."}, status=200)

        smtp_settings = get_enabled_smtp_settings()
        if not smtp_settings:
            return JsonResponse({"type": "SMTPConfigError", "message": "SMTP settings are not enabled in admin."}, status=400)

        from_email = smtp_settings.from_email or smtp_settings.username
        if not from_email:
            return JsonResponse({"type": "SMTPConfigError", "message": "SMTP from email is missing."}, status=400)

        index_name = body.get("indexName", "Index")
        symbol = body.get("symbol", "")
        previous_lots = parse_float(body.get("previousNetLots"), 0.0)
        current_lots = parse_float(body.get("currentNetLots"), 0.0)
        index_level = parse_float(body.get("indexLevel"), 0.0)
        direction = "Demand increased" if swing_lots > 0 else "Supply increased"
        subject = f"{index_name} lot swing alert: {abs_swing_lots:.2f} lots"
        message = (
            f"{direction} by {abs_swing_lots:.2f} lots.\n\n"
            f"Index: {index_name}\n"
            f"Symbol: {symbol}\n"
            f"Index level: {index_level:.2f}\n"
            f"Previous net lots: {previous_lots:.2f}\n"
            f"Current net lots: {current_lots:.2f}\n"
            f"Configured threshold: {threshold:.2f} lots\n"
            f"Alert time: {dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        )

        connection = get_connection(
            host=smtp_settings.host,
            port=smtp_settings.port,
            username=smtp_settings.username or None,
            password=smtp_settings.password or None,
            use_tls=smtp_settings.use_tls,
            use_ssl=smtp_settings.use_ssl,
        )
        email = EmailMessage(subject, message, from_email, [user.alert_email], connection=connection)
        email.send(fail_silently=False)

        return JsonResponse({"type": "success", "message": "Alert email sent."}, status=200)

    except Exception as e:
        traceback.print_exc()
        log(f"Error {e} occured while sending lot swing alert !", "ERROR")

        return JsonResponse({"type": "ServerError", "message": "Server Error occured while sending the alert email !"}, status=500)



@require_http_methods(["GET"])
def acdd_signals(request):
    """Return AC/DD signals for today's ATM option snapshots.

    Query params:
        timeframes: comma-separated minute buckets to compute (default "5,15").

    Uses the caller's saved contract_month so each user sees signals for
    the contract they're tracking.
    """
    res = protected(request)

    if isinstance(res, JsonResponse):
        return res

    try:
        user = res[1]

        raw = request.GET.get("timeframes", "5,15")
        timeframes = []
        for chunk in raw.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                value = int(chunk)
            except ValueError:
                continue
            if value > 0 and value not in timeframes:
                timeframes.append(value)

        if not timeframes:
            timeframes = [5, 15]

        contract_month = user.contract_month or "current"
        if contract_month not in CONTRACT_MONTH_INDEX:
            contract_month = "current"

        result = acdd_analyzer.compute_signals(contract_month, timeframes)

        return JsonResponse({
            "type": "success",
            "message": "Computed AC/DD signals.",
            "contractMonth": contract_month,
            "timeframes": timeframes,
            "thresholds": {
                "priceChangePct": acdd_analyzer.PRICE_THRESHOLD_PCT,
                "volumeDiffPct": acdd_analyzer.VOLUME_THRESHOLD_PCT,
            },
            "byTimeframe": result["byTimeframe"],
        }, status=200)

    except Exception as e:
        traceback.print_exc()
        log(f"Error {e} occured while computing AC/DD signals !", "ERROR")

        return JsonResponse({"type": "ServerError", "message": "Server Error occured while computing AC/DD signals !"}, status=500)

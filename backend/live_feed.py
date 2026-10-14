"""One broker connection, shared through the database by every web worker."""
import math
import threading
import time
import uuid

from django.db.models import Q
from django.utils import timezone
from kiteconnect import KiteTicker

from .instruments import resolve_spot_tokens
from .market_contracts import contract_to_payload, get_master_contract, resolve_contract_rows
from .models import KiteSettings, LiveMarketFeed


LEASE_SECONDS = 30
TICK_FIELDS = (
    "last_price", "change", "average_traded_price", "volume_traded",
    "total_buy_quantity", "total_sell_quantity", "oi", "oi_day_high", "oi_day_low",
)


def public_tick(tick):
    result = {}
    for field in TICK_FIELDS:
        value = tick.get(field)
        if isinstance(value, (int, float)) and math.isfinite(value):
            result[field] = value
    result["ohlc"] = {
        key: value for key, value in tick.get("ohlc", {}).items()
        if key in ("open", "high", "low", "close")
        and isinstance(value, (int, float)) and math.isfinite(value)
    }
    result["receivedAt"] = int(time.time() * 1000)
    return result


class SharedMarketFeed:
    def __init__(self, dispatch, ticker_factory=KiteTicker):
        self.owner = uuid.uuid4().hex
        self.dispatch = dispatch
        self.ticker_factory = ticker_factory
        self.lock = threading.RLock()
        self.ticker = None
        self.signature = None
        self.tokens = []
        self.contracts = {}
        self.spot_tokens = {}
        self.ticks = {}
        self.connected = False
        self.last_message = 0
        self.exhausted = False

    def renew_lease(self):
        now = time.time()
        LiveMarketFeed.objects.get_or_create(pk=1)
        return bool(LiveMarketFeed.objects.filter(pk=1).filter(
            Q(owner=self.owner) | Q(lease_until__lt=now)
        ).update(owner=self.owner, lease_until=now + LEASE_SECONDS))

    def owns_lease(self):
        return LiveMarketFeed.objects.filter(pk=1, owner=self.owner, lease_until__gt=time.time()).exists()

    def configure(self):
        credentials = KiteSettings.objects.order_by("-updated_at", "-id").first()
        if not credentials or not credentials.api_key or not credentials.access_token:
            self.disconnect()
            return
        frame = get_master_contract()
        contracts = {}
        tokens = set()
        for (month, key), row in resolve_contract_rows(frame).items():
            token = int(row["instrument_token"])
            contracts.setdefault(month, {})[key] = {**contract_to_payload(row), "token": token}
            tokens.add(token)
        spots = resolve_spot_tokens(frame)
        tokens.update(token for token in spots.values() if token is not None)
        tokens = sorted(tokens)
        signature = (credentials.api_key, credentials.access_token, tuple(tokens))
        with self.lock:
            self.contracts = contracts
            self.spot_tokens = spots
            if signature == self.signature and not self.exhausted:
                return
        self.disconnect()
        ticker = self.ticker_factory(credentials.api_key, credentials.access_token,
                                     reconnect=True, reconnect_max_tries=10, reconnect_max_delay=30)
        with self.lock:
            self.signature = signature
            self.tokens = tokens
            self.ticker = ticker
            self.exhausted = False
        ticker.on_connect = self.on_connect
        ticker.on_ticks = self.on_ticks
        ticker.on_message = self.on_message
        ticker.on_close = self.on_close
        ticker.on_error = self.on_close
        ticker.on_reconnect = self.on_reconnect
        ticker.on_noreconnect = self.on_noreconnect
        self.dispatch(ticker.connect)

    def on_connect(self, ticker, response):
        with self.lock:
            if ticker is not self.ticker:
                ticker.close()
                return
            ticker.subscribe(self.tokens)
            ticker.set_mode(ticker.MODE_FULL, self.tokens)
            self.connected = True
            self.last_message = time.time()

    def on_ticks(self, ticker, ticks):
        with self.lock:
            if ticker is not self.ticker or not self.connected:
                return
            for tick in ticks:
                token = tick.get("instrument_token")
                if token in self.tokens:
                    self.ticks[str(token)] = public_tick(tick)
            self.last_message = time.time()

    def on_message(self, ticker, payload, is_binary):
        with self.lock:
            if ticker is self.ticker:
                self.last_message = time.time()

    def on_close(self, ticker, *args):
        with self.lock:
            if ticker is self.ticker:
                self.connected = False
                self.ticks = {}

    def on_reconnect(self, ticker, attempts):
        self.on_close(ticker)

    def on_noreconnect(self, ticker):
        with self.lock:
            if ticker is self.ticker:
                self.exhausted = True
                self.connected = False
                self.ticks = {}

    def publish(self):
        with self.lock:
            live = self.connected and time.time() - self.last_message < 30
            payload = {
                "status": "live" if live else "offline",
                "ticks": dict(self.ticks) if live else {},
                "contracts": self.contracts,
                "spotTokens": self.spot_tokens,
            }
        return LiveMarketFeed.objects.filter(pk=1, owner=self.owner).update(
            payload=payload, updated_at=timezone.now()
        )

    def disconnect(self):
        with self.lock:
            ticker = self.ticker
            self.ticker = None
            self.signature = None
            self.connected = False
            self.ticks = {}
        if ticker:
            self.dispatch(ticker.close)

    def stop(self):
        self.disconnect()
        LiveMarketFeed.objects.filter(pk=1, owner=self.owner).update(
            owner="", lease_until=0, payload={"status": "offline"}, updated_at=timezone.now()
        )

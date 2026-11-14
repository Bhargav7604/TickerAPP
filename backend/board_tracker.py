"""Live state for the Market, Money Flow and Intraday pages, kept by the market-feed worker from Zerodha ticks.

Every stock gets one-minute bars and a running money flow: traded value added when a trade prints on an up-tick and
subtracted on a down-tick. The worker publishes a compact snapshot every few seconds and the scanner once a minute;
web requests only read what was published.
"""
import datetime as dt
import threading
import time

from django.utils import timezone

from .board_signals import (CORE, INDICATORS, SESSION_MINUTES, finite, indicators, pct, sector_flow, trade_plan)
from .board_universe import previous_candle, previous_oi, universe
from .market_contracts import MARKET_TZ
from .models import IndexWeights, LiveMarketFeed, OptionOISnapshot, UniverseStats

SNAPSHOT_ID = 7
SCANNER_IDS = {1: 8, 3: 9, 5: 10}
SNAPSHOT_EVERY = 3
SESSION_OPEN = dt.time(9, 15)
SESSION_CLOSE = dt.time(15, 30)
QUOTE_BATCH = 450
QUOTE_PAUSE = 1.05
BACKFILL_PAUSE = 0.4
STOCK_FIELDS = ("sym", "sector", "cap", "flags", "ltp", "prev", "open", "high", "low", "vwap", "volume", "avgVol",
                "prevH", "prevL", "hi52", "lo52", "oi", "prevOi", "flow", "flow30", "p30", "lc", "uc", "lot", "company")


def minute_of(moment):
    """Minutes since 09:15 IST, clamped to the session (pre-open trades count as the first minute)."""
    local = moment.astimezone(MARKET_TZ)
    minutes = (local.hour * 60 + local.minute) - (SESSION_OPEN.hour * 60 + SESSION_OPEN.minute)
    return min(max(minutes, 0), SESSION_MINUTES - 1)


def in_session(moment):
    local = moment.astimezone(MARKET_TZ)
    return local.weekday() < 5 and SESSION_OPEN <= local.time() <= SESSION_CLOSE


class StockState:
    __slots__ = ("ltp", "open", "high", "low", "prev", "vwap", "volume", "last_volume", "last_price", "sign",
                 "bars", "flow", "oi", "fut_prev", "lc", "uc", "live", "backfilled")

    def __init__(self):
        self.ltp = self.open = self.high = self.low = self.prev = self.vwap = self.volume = None
        self.last_volume = self.last_price = None
        self.sign = 1
        self.bars = {}  # minute -> [open, high, low, close, volume, flow]
        self.flow = 0.0
        self.oi = self.fut_prev = self.lc = self.uc = None
        self.live = False
        self.backfilled = False


class BoardTracker:
    def __init__(self):
        self.lock = threading.RLock()
        self.stocks = []
        self.indices = []
        self.by_token = {}  # token -> ("stock", symbol) | ("fut", symbol) | ("index", key)
        self.state = {}
        self.index_state = {}
        self.session = None
        self.seeded_on = None
        self.circuits_on = None
        self.started = None
        self.last_tick = 0.0
        self.last_publish = 0.0
        self.extras = {}
        self.stats_cache = (0.0, {})

    # ---- setup -------------------------------------------------------------------------------------------------
    def configure(self, now=None):
        """Refresh the universe; returns {token: "full" | "quote"} to subscribe."""
        stocks, indices = universe(now)
        with self.lock:
            self.stocks, self.indices = stocks, indices
            by_token = {}
            for stock in stocks:
                by_token[stock["token"]] = ("stock", stock["symbol"])
                if stock["fut"]:
                    by_token[stock["fut"]["token"]] = ("fut", stock["symbol"])
                self.state.setdefault(stock["symbol"], StockState())
            for index in indices:
                by_token[index["token"]] = ("index", index["key"])
                self.index_state.setdefault(index["key"], {})
            self.by_token = by_token
            if self.started is None:
                self.started = dt.datetime.now(MARKET_TZ)
            return {token: "full" if kind == "fut" else "quote" for token, (kind, _) in by_token.items()}

    def roll_session(self, session):
        """A new trading day starts with empty bars and money flow."""
        if self.session == session:
            return
        if self.session is not None:
            self.state = {symbol: StockState() for symbol in self.state}
            self.index_state = {key: {} for key in self.index_state}
            self.circuits_on = None
        self.session = session

    # ---- ticks -------------------------------------------------------------------------------------------------
    def on_ticks(self, ticks, now=None):
        now = now or dt.datetime.now(MARKET_TZ)
        if not in_session(now) and now.astimezone(MARKET_TZ).time() < dt.time(9, 0):
            return
        minute = minute_of(now)
        with self.lock:
            self.roll_session(now.astimezone(MARKET_TZ).date())
            for tick in ticks:
                target = self.by_token.get(tick.get("instrument_token"))
                if not target:
                    continue
                kind, key = target
                price = tick.get("last_price")
                if not finite(price) or price <= 0:
                    continue
                if kind == "index":
                    ohlc = tick.get("ohlc") or {}
                    self.index_state[key] = {"ltp": price, "open": ohlc.get("open"), "high": ohlc.get("high"),
                                             "low": ohlc.get("low"), "prev": ohlc.get("close")}
                elif kind == "fut":
                    state = self.state[key]
                    if finite(tick.get("oi")):
                        state.oi = tick["oi"]
                else:
                    self.stock_tick(self.state[key], tick, price, minute)
            self.last_tick = time.time()

    @staticmethod
    def stock_tick(state, tick, price, minute):
        ohlc = tick.get("ohlc") or {}
        state.ltp = price
        state.open, state.high, state.low = ohlc.get("open") or state.open, ohlc.get("high") or state.high, ohlc.get("low") or state.low
        state.prev = ohlc.get("close") or state.prev
        state.vwap = tick.get("average_traded_price") or state.vwap
        volume = tick.get("volume_traded")
        if not finite(volume):
            return
        state.live = True
        traded = 0
        if state.last_volume is not None and volume >= state.last_volume:
            traded = volume - state.last_volume
        if state.last_price is not None:
            state.sign = 1 if price > state.last_price else -1 if price < state.last_price else state.sign
        state.last_volume, state.last_price, state.volume = volume, price, volume
        bar = state.bars.get(minute)
        if bar is None:
            state.bars[minute] = bar = [price, price, price, price, 0, 0.0]
        else:
            bar[1], bar[2], bar[3] = max(bar[1], price), min(bar[2], price), price
        if traded:
            flow = traded * price * state.sign
            bar[4] += traded
            bar[5] += flow
            state.flow += flow

    # ---- REST seeding and gap filling ------------------------------------------------------------------------
    def seed(self, client, now=None, pause=QUOTE_PAUSE):
        """Prices, volumes, OI and circuit limits from one round of quote requests. Live ticks are never overwritten."""
        now = now or dt.datetime.now(MARKET_TZ)
        with self.lock:
            names = {f"NSE:{stock['quoteSymbol']}": ("stock", stock["symbol"]) for stock in self.stocks}
            names.update({f"NFO:{stock['fut']['symbol']}": ("fut", stock["symbol"]) for stock in self.stocks if stock["fut"]})
            names.update({f"{self.index_exchange(index)}:{index['name']}": ("index", index["key"]) for index in self.indices})
        quotes = {}
        keys = list(names)
        for start in range(0, len(keys), QUOTE_BATCH):
            quotes.update(client.quote(keys[start:start + QUOTE_BATCH]))
            if start + QUOTE_BATCH < len(keys):
                time.sleep(pause)
        traded = [quote.get("last_trade_time") for quote in quotes.values() if isinstance(quote.get("last_trade_time"), dt.datetime)]
        session = max(traded).date() if traded else now.date()
        with self.lock:
            self.roll_session(session)
            for name, quote in quotes.items():
                kind, key = names.get(name, (None, None))
                ohlc = quote.get("ohlc") or {}
                if kind == "index":
                    if not self.index_state.get(key, {}).get("ltp") or not self.live_now():
                        self.index_state[key] = {"ltp": quote.get("last_price"), "open": ohlc.get("open"), "high": ohlc.get("high"),
                                                 "low": ohlc.get("low"), "prev": ohlc.get("close")}
                elif kind == "fut":
                    state = self.state[key]
                    if state.oi is None or not self.live_now():
                        state.oi = quote.get("oi") or state.oi
                elif kind == "stock":
                    state = self.state[key]
                    state.lc, state.uc = quote.get("lower_circuit_limit") or state.lc, quote.get("upper_circuit_limit") or state.uc
                    if not state.live:
                        state.ltp = quote.get("last_price") or state.ltp
                        state.open, state.high, state.low = ohlc.get("open") or None, ohlc.get("high") or None, ohlc.get("low") or None
                        state.prev = ohlc.get("close") or state.prev
                        state.vwap = quote.get("average_price") or None
                        state.volume = quote.get("volume") or state.volume
            self.seeded_on = now.date()
            if now.astimezone(MARKET_TZ).time() >= dt.time(9, 8):
                self.circuits_on = now.date()
        return len(quotes)

    @staticmethod
    def index_exchange(index):
        return "BSE" if index["key"] == "SENSEX" else "NSE"

    def live_now(self):
        return time.time() - self.last_tick < 30

    def backfill(self, client, now=None, max_calls=600, pause=BACKFILL_PAUSE):
        """Minute bars the worker missed (it started late, or the market is closed) from Zerodha's minute history."""
        now = now or dt.datetime.now(MARKET_TZ)
        with self.lock:
            session = self.session
            todo = [(stock["symbol"], stock["token"]) for stock in self.stocks if not self.state[stock["symbol"]].backfilled]
            first_live = {symbol: min(state.bars) if state.live and state.bars else None for symbol, state in self.state.items()}
        if session is None:
            return 0
        start = dt.datetime.combine(session, SESSION_OPEN)
        end = min(now.astimezone(MARKET_TZ).replace(tzinfo=None), dt.datetime.combine(session, SESSION_CLOSE))
        if end <= start:
            return 0
        calls = 0
        for symbol, token in todo:
            if calls >= max_calls:
                break
            if first_live.get(symbol) == 0:
                with self.lock:
                    self.state[symbol].backfilled = True  # watched from the open; nothing to fill
                continue
            try:
                candles = client.historical_data(token, start, end, "minute")
                calls += 1
                time.sleep(pause)
            except Exception as exc:
                if type(exc).__name__ in ("TokenException", "PermissionException"):
                    break
                continue
            self.merge_history(symbol, candles)
        return calls

    def merge_history(self, symbol, candles):
        """Fill minutes with no live bar. Their flow uses the close-to-close direction of each minute."""
        bars, sign, last_close = {}, 1, None
        for row in candles:
            moment = row["date"]
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=MARKET_TZ)
            close, volume = row["close"], row.get("volume") or 0
            if last_close is not None:
                sign = 1 if close > last_close else -1 if close < last_close else sign
            last_close = close
            bars[minute_of(moment)] = [row["open"], row["high"], row["low"], close, volume, volume * close * sign]
        with self.lock:
            state = self.state.get(symbol)
            if state is None:
                return
            live_from = min(state.bars) if state.live and state.bars else SESSION_MINUTES
            for minute, bar in bars.items():
                if minute < live_from and minute not in state.bars:
                    state.bars[minute] = bar
                    state.flow += bar[5]
            if not state.live and bars:
                last = bars[max(bars)]
                state.ltp = state.ltp or last[3]
            state.backfilled = True

    # ---- publishing --------------------------------------------------------------------------------------------
    def current_minute(self, now):
        if self.session == now.astimezone(MARKET_TZ).date() and in_session(now):
            return minute_of(now)
        return SESSION_MINUTES - 1

    def stats(self, max_age=60):
        """UniverseStats by symbol, re-read at most once a minute (they change once a day)."""
        at, cached = self.stats_cache
        if time.time() - at < max_age and cached:
            return cached
        cached = {row.symbol: row for row in UniverseStats.objects.filter(
            symbol__in=[stock["symbol"] for stock in self.stocks] + [index["name"] for index in self.indices])}
        self.stats_cache = (time.time(), cached)
        return cached

    def rows(self, now, stats):
        """Plain stock dicts for the snapshot and the scanner. Call with the lock held."""
        minute = self.current_minute(now)
        rows = []
        for stock in self.stocks:
            state = self.state.get(stock["symbol"])
            if state is None or not finite(state.ltp):
                continue
            stat = stats.get(stock["symbol"])
            prev_candle = previous_candle(stat.recent, self.session) if stat and self.session else None
            flow30 = sum(bar[5] for m, bar in state.bars.items() if minute - 30 < m <= minute)
            back = [m for m in state.bars if m <= minute - 30]
            rows.append({
                "sym": stock["symbol"], "company": stock["company"], "sector": stock["sector"], "cap": stock["cap"],
                "flags": stock["flags"], "ltp": state.ltp, "prev": state.prev, "open": state.open, "high": state.high,
                "low": state.low, "vwap": state.vwap, "volume": state.volume,
                "avgVol": stat.avg_volume if stat else None, "prevH": prev_candle[2] if prev_candle else None,
                "prevL": prev_candle[3] if prev_candle else None, "hi52": stat.high_52w if stat else None,
                "lo52": stat.low_52w if stat else None, "oi": state.oi,
                "prevOi": previous_oi(stat.fut_oi, self.session) if stat and stock["fut"] and self.session else None,
                "flow": round(state.flow), "flow30": round(flow30), "p30": state.bars[max(back)][3] if back else None,
                "lc": state.lc, "uc": state.uc, "lot": stock["fut"]["lot"] if stock["fut"] else None,
            })
        return rows

    def index_rows(self, stats):
        rows = []
        for index in self.indices:
            state = self.index_state.get(index["key"]) or {}
            stat = stats.get(index["name"])
            prev_candle = previous_candle(stat.recent, self.session) if stat and self.session else None
            rows.append({"key": index["key"], "label": index["label"], "ltp": state.get("ltp"), "prev": state.get("prev"),
                         "open": state.get("open"), "high": state.get("high"), "low": state.get("low"),
                         "prevH": prev_candle[2] if prev_candle else None, "prevL": prev_candle[3] if prev_candle else None,
                         "prevC": prev_candle[4] if prev_candle else None})
        return rows

    def status(self, now):
        if self.live_now():
            return "live"
        return "closed" if self.session and not in_session(now) else "waiting"

    def snapshot(self, now=None):
        now = now or dt.datetime.now(MARKET_TZ)
        stats = self.stats()
        with self.lock:
            rows = self.rows(now, stats)
            indices = self.index_rows(stats)
            minute = self.current_minute(now)
            session = self.session
            status = self.status(now)
        return {
            "status": status, "session": session.isoformat() if session else None, "asOf": int(time.time()),
            "minute": minute, "paceFrac": round(min(minute + 1, SESSION_MINUTES) / SESSION_MINUTES, 4),
            "fields": list(STOCK_FIELDS), "rows": [[row.get(field) for field in STOCK_FIELDS] for row in rows],
            "indices": indices, **self.extras,
        }

    def publish_snapshot(self, now=None, force=False):
        if not force and time.time() - self.last_publish < SNAPSHOT_EVERY:
            return False
        self.last_publish = time.time()
        payload = self.snapshot(now)
        LiveMarketFeed.objects.update_or_create(pk=SNAPSHOT_ID, defaults={"payload": payload, "updated_at": timezone.now()})
        return True

    def scanner(self, now=None):
        """The 13 checks and a trade plan for every stock, on 1, 3 and 5-minute bars."""
        now = now or dt.datetime.now(MARKET_TZ)
        stats = self.stats()
        with self.lock:
            rows = self.rows(now, stats)
            bars = {symbol: sorted((m, *bar) for m, bar in state.bars.items()) for symbol, state in self.state.items()}
            nifty = self.index_state.get("NIFTY") or {}
            minute = self.current_minute(now)
        for row in rows:
            row["value"] = (row["vwap"] or row["ltp"]) * (row["volume"] or 0)
        sectors = sector_flow([{**row, "symbol": row["sym"]} for row in rows])
        tags = {row["sector"]: (row["tag"], row["score"]) for row in sectors}
        nifty_change = pct(nifty.get("ltp"), nifty.get("prev"))
        results = {}
        for size in SCANNER_IDS:
            out = []
            for row in rows:
                checks, trend = indicators(row, bars.get(row["sym"], []), size, minute, nifty_change, tags)
                plan = trade_plan(row["ltp"], checks, trend)
                out.append([row["sym"], "".join("+" if key in checks and checks[key][0] > 0 else "-" if key in checks and checks[key][0] < 0
                                                 else "0" if key in checks else "." for key in INDICATORS),
                            {key: checks[key][1:] for key in checks}, plan["stop"], plan["target"]])
            results[size] = {"asOf": int(time.time()), "minute": minute, "bars": size, "indicators": list(INDICATORS),
                             "core": list(CORE), "rows": out}
        return results, sectors

    def publish_scanner(self, now=None):
        results, sectors = self.scanner(now)
        for size, payload in results.items():
            LiveMarketFeed.objects.update_or_create(pk=SCANNER_IDS[size], defaults={"payload": payload, "updated_at": timezone.now()})
        self.extras = {**self.extras, "sectorFlow": sectors, **self.minute_extras()}
        return len(results)

    def minute_extras(self):
        """Once a minute: NIFTY put-call ratio from the OI recorder and index weights for the heatmap and contribution."""
        extras = {}
        latest = OptionOISnapshot.objects.filter(index_key="nifty").order_by("-bucket_time").first()
        if latest:
            rows = OptionOISnapshot.objects.filter(index_key="nifty", expiry=latest.expiry, bucket_time=latest.bucket_time)
            calls = sum(row.oi for row in rows if row.option_type == "CE")
            puts = sum(row.oi for row in rows if row.option_type == "PE")
            extras["pcr"] = round(puts / calls, 2) if calls else None
        weights = {}
        for row in IndexWeights.objects.filter(index_key__in=["nifty", "sensex"]):
            weights[row.index_key] = row.coefficients
        extras["weights"] = weights
        return extras

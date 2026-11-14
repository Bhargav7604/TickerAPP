"""Scheduled work for the Market, Money Flow and Intraday pages, run by the market-feed worker."""
import datetime as dt

from .board_universe import refresh_universe_stats
from .equity import broker
from .logger import log
from .market_contracts import MARKET_TZ

CIRCUITS_FROM = dt.time(9, 8)


def maintain_board(tracker, client=None, now=None):
    """Once a minute: quotes when needed (start-up, a new day, circuit limits after pre-open), missed minute bars, daily stats."""
    now = now or dt.datetime.now(MARKET_TZ)
    if client is None:
        client, _ = broker()
        if not client:
            return {}
    if not tracker.stocks:
        tracker.configure(now)
    done = {}
    try:
        if tracker.seeded_on != now.date() or (now.time() >= CIRCUITS_FROM and tracker.circuits_on != now.date()):
            done["seeded"] = tracker.seed(client, now)
        done["backfilled"] = tracker.backfill(client, now)
        done["stats"] = refresh_universe_stats(client, now)
    except Exception as exc:
        log(f"Market board upkeep stopped early ({type(exc).__name__}).", "ERROR")
    return done


def publish_board_scanner(tracker, now=None):
    if not tracker.stocks:
        return 0
    try:
        return tracker.publish_scanner(now)
    except Exception as exc:
        log(f"Market board scanner unavailable ({type(exc).__name__}).", "ERROR")
        return 0

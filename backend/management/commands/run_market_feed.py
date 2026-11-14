import signal
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from twisted.internet import reactor

from backend.live_feed import SharedMarketFeed
from backend.master_contract_updater import fetch_master_contract
from backend.oi_recorder import record_option_oi
from backend.alerts import run_alert_cycle
from backend.index_stocks import refresh_stock_history, sync_index_constituents
from backend.index_weights import refresh_all_index_weights
from backend.snapshot_recorder import record_market_snapshot
from backend.board_jobs import maintain_board, publish_board_scanner
from backend.board_tracker import BoardTracker


class Command(BaseCommand):
    help = "Run the shared broker feed, the five-minute snapshot recorder and the three-minute option OI recorder."

    def handle(self, *args, **options):
        stopped = threading.Event()
        tracker = BoardTracker()
        feed = SharedMarketFeed(reactor.callFromThread, tracker=tracker)
        if not feed.renew_lease():
            raise CommandError("A market-feed worker is already running for this database.")

        def stop(*_):
            stopped.set()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        thread = threading.Thread(target=reactor.run, kwargs={"installSignalHandlers": False}, daemon=True)
        thread.start()

        def guarded(job):
            close_old_connections()
            try:
                if feed.owns_lease():
                    job()
            finally:
                close_old_connections()

        scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
        scheduler.add_job(guarded, "date", args=[fetch_master_contract])
        scheduler.add_job(guarded, "cron", hour=8, minute=30, args=[fetch_master_contract])
        scheduler.add_job(guarded, "cron", minute="*/5", second=5,
                          args=[record_market_snapshot], coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", minute="*/3", second=20,
                          args=[record_option_oi], coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", minute="*/5", second=40,
                          args=[run_alert_cycle], coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", day_of_week="mon-fri", hour=8, minute=40, args=[sync_index_constituents])
        scheduler.add_job(guarded, "date", args=[refresh_stock_history])
        # Market, Money Flow and Intraday pages: cap lists, quotes, missed minute bars and daily stats; then the scanner.
        scheduler.add_job(guarded, "date", args=[sync_index_constituents])
        scheduler.add_job(guarded, "cron", minute="*", second=12, args=[lambda: maintain_board(tracker)],
                          coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", minute="*", second=35, args=[lambda: publish_board_scanner(tracker)],
                          coalesce=True, max_instances=1)
        # Sector contribution weights: once each trading morning, retried before and after the open if it failed.
        scheduler.add_job(guarded, "date", args=[refresh_all_index_weights])
        scheduler.add_job(guarded, "cron", day_of_week="mon-fri", hour=8, minute=45, second=5,
                          args=[refresh_all_index_weights], coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", day_of_week="mon-fri", hour=9, minute="5,25", second=5,
                          args=[refresh_all_index_weights], coalesce=True, max_instances=1)
        scheduler.add_job(guarded, "cron", day_of_week="mon-fri", hour="8-15", minute="*/10", second=50,
                          args=[refresh_stock_history], coalesce=True, max_instances=1)
        scheduler.start()
        self.stdout.write("Shared market-feed worker started.")
        next_configure = 0
        try:
            while not stopped.is_set():
                close_old_connections()
                if not feed.renew_lease():
                    raise CommandError("Market-feed ownership changed; stopping this worker.")
                if time.monotonic() >= next_configure:
                    try:
                        feed.configure()
                    except Exception as exc:
                        feed.disconnect()
                        self.stderr.write(f"Feed configuration unavailable ({type(exc).__name__}); retrying.")
                    next_configure = time.monotonic() + 5
                feed.publish()
                try:
                    tracker.publish_snapshot()
                except Exception as exc:
                    self.stderr.write(f"Board snapshot unavailable ({type(exc).__name__}).")
                stopped.wait(1)
        finally:
            scheduler.shutdown(wait=True)
            feed.stop()
            reactor.callFromThread(reactor.stop)
            thread.join(timeout=5)

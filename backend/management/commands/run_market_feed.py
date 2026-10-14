import signal
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from twisted.internet import reactor

from backend.live_feed import SharedMarketFeed
from backend.master_contract_updater import fetch_master_contract
from backend.snapshot_recorder import record_market_snapshot


class Command(BaseCommand):
    help = "Run the shared broker feed and server-only five-minute snapshot recorder."

    def handle(self, *args, **options):
        stopped = threading.Event()
        feed = SharedMarketFeed(reactor.callFromThread)
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
                stopped.wait(1)
        finally:
            scheduler.shutdown(wait=True)
            feed.stop()
            reactor.callFromThread(reactor.stop)
            thread.join(timeout=5)

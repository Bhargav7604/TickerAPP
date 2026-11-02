from django.core.management.base import BaseCommand

from backend.index_stocks import refresh_stock_history, sync_index_constituents


class Command(BaseCommand):
    help = "Refresh NIFTY 50 / NIFTY BANK constituents from NSE and save daily candles for every index stock."

    def handle(self, *args, **options):
        self.stdout.write(f"Constituents synced: {sync_index_constituents() or 'none (kept saved lists)'}")
        self.stdout.write(f"Stocks with fresh daily history: {refresh_stock_history(max_calls=1000)}")

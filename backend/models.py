from django.db import models
from django.utils import timezone
from django.contrib.auth.hashers import check_password, make_password

CONTRACT_MONTHS = (
    ("current", "Current"),
    ("next", "Next"),
    ("far", "Far"),
)
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587

# TIMEFRAMES = (
#     ("Hourly", "Hourly"),
#     ("Daily", "Daily")
# )
#
# SIDES = (
#     ("BUY", "BUY"),
#     ("SELL", "SELL")
# )


class User(models.Model):
    username = models.CharField(max_length=50, unique=True)
    password = models.CharField(max_length=128)
    active_session_token = models.CharField(max_length=100, blank=True, default="")
    valid_until = models.DateField(blank=True, null=True)

    broker_username = models.CharField(max_length=20, blank=True, default="")
    broker_password = models.CharField(max_length=50, blank=True, default="")
    broker_twofa = models.CharField(max_length=10, blank=True, default="")
    broker_api_key = models.CharField(max_length=100, blank=True, default="")
    broker_api_secret = models.CharField(max_length=100, blank=True, default="")
    broker_access_token = models.CharField(max_length=100, blank=True, default="")

    nifty_expiry = models.DateField(default=timezone.now)
    banknifty_expiry = models.DateField(default=timezone.now)
    finnifty_expiry = models.DateField(default=timezone.now)
    sensex_expiry = models.DateField(default=timezone.now)
    contract_month = models.CharField(max_length=20, default="current", choices=CONTRACT_MONTHS)
    market_columns = models.JSONField(null=True, blank=True, default=None, editable=False)
    alerts_enabled = models.BooleanField(default=False)
    alert_email = models.EmailField(blank=True, default="")
    alert_lot_threshold = models.FloatField(default=400.0)

    # started = models.BooleanField(default=False)
    # timeframe = models.CharField(max_length=100, default="Hourly", choices=TIMEFRAMES)
    # completion_status = models.IntegerField(default=0)
    #
    # # Report
    # num_trades = models.IntegerField(default=0)
    # num_long_trades = models.IntegerField(default=0)
    # num_short_trades = models.IntegerField(default=0)
    # num_profit_trades = models.IntegerField(default=0)
    # num_loss_trades = models.IntegerField(default=0)
    # total_profit = models.FloatField(default=0.0)
    # total_loss = models.FloatField(default=0.0)
    # maximum_gain = models.FloatField(default=0.0)
    # maximum_drawdown = models.FloatField(default=0.0)
    # avg_pnl_per_trade = models.FloatField(default=0.0)
    # brokerage = models.FloatField(default=0.0)
    # total_pnl = models.FloatField(default=0.0)
    #
    # trades = models.ManyToManyField("Trade", blank=True)

    def set_password(self, raw_password):
        self.password = make_password(raw_password)
        self.active_session_token = ""

    def check_password(self, raw_password):
        return check_password(raw_password, self.password)

    def __str__(self):
        return self.username

    class Meta:
        verbose_name = "App User"
        verbose_name_plural = "App Users"


class SMTPSettings(models.Model):
    enabled = models.BooleanField(default=False)
    host = models.CharField(max_length=200, default=GMAIL_SMTP_HOST)
    port = models.PositiveIntegerField(default=GMAIL_SMTP_PORT)
    username = models.CharField(max_length=200, blank=True, default="")
    password = models.CharField(max_length=200, blank=True, default="")
    from_email = models.EmailField(blank=True, default="")
    use_tls = models.BooleanField(default=True)
    use_ssl = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.host

    class Meta:
        verbose_name = "SMTP Setting"
        verbose_name_plural = "SMTP Settings"


class KiteSettings(models.Model):
    api_key = models.CharField(max_length=100, blank=True, default="")
    api_secret = models.CharField(max_length=100, blank=True, default="")
    access_token = models.CharField(max_length=100, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return "Kite Settings"

    class Meta:
        verbose_name = "Kite Setting"
        verbose_name_plural = "Kite Settings"


class LiveMarketFeed(models.Model):
    owner = models.CharField(max_length=64, blank=True, default="")
    lease_until = models.FloatField(default=0)
    payload = models.JSONField(default=dict)
    updated_at = models.DateTimeField(default=timezone.now)


class MarketSnapshot(models.Model):
    INDEX_CHOICES = (
        ("nifty", "NIFTY"),
        ("banknifty", "BANKNIFTY"),
        ("sensex", "SENSEX"),
    )

    index_key = models.CharField(max_length=20, choices=INDEX_CHOICES)
    contract_month = models.CharField(max_length=20, default="current", choices=CONTRACT_MONTHS)
    symbol = models.CharField(max_length=50)
    instrument_type = models.CharField(max_length=10, default="FUT")
    strike = models.FloatField(blank=True, null=True)
    bucket_time = models.DateTimeField(db_index=True)
    index_level = models.FloatField(default=0.0)
    net_lots = models.FloatField(default=0.0)
    demand_supply_ratio = models.FloatField(blank=True, null=True)
    volume_traded = models.FloatField(blank=True, null=True)
    interval_volume = models.FloatField(blank=True, null=True)
    vwap = models.FloatField(blank=True, null=True)
    source = models.CharField(max_length=20, default="backend")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.symbol} {self.bucket_time:%Y-%m-%d %H:%M}"

    class Meta:
        verbose_name = "Market Snapshot"
        verbose_name_plural = "Market Snapshots"
        constraints = [
            models.UniqueConstraint(
                fields=["index_key", "contract_month", "symbol", "bucket_time"],
                name="unique_market_snapshot_bucket",
            ),
        ]
        indexes = [
            models.Index(fields=["bucket_time", "index_key"]),
            models.Index(fields=["contract_month", "symbol"]),
        ]


# class Trade(models.Model):
#     date = models.DateTimeField(default=timezone.now)
#     ticker = models.CharField(max_length=100)
#     side = models.CharField(max_length=100, choices=SIDES)
#     entry_price = models.FloatField(default=0)
#     exit_price = models.FloatField(default=0)
#     pnl = models.FloatField(default=0)
#
#     def __str__(self):
#         return f"{self.ticker} - {self.date}"

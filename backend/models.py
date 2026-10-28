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
    # alert_lot_threshold is the NIFTY threshold; SENSEX trades far fewer lots, so each index has its own.
    alert_lot_threshold = models.FloatField(default=400.0)
    banknifty_alert_lot_threshold = models.FloatField(default=400.0)
    sensex_alert_lot_threshold = models.FloatField(default=40.0)

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


class OptionOISnapshot(models.Model):
    """Open interest for one index option strike, recorded every three minutes (bucket_time is naive IST)."""

    index_key = models.CharField(max_length=20)
    expiry = models.DateField()
    strike = models.FloatField()
    option_type = models.CharField(max_length=2)
    bucket_time = models.DateTimeField()
    underlying = models.FloatField(blank=True, null=True)
    oi = models.FloatField()
    ltp = models.FloatField(blank=True, null=True)
    prev_close = models.FloatField(blank=True, null=True)
    volume = models.FloatField(blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["index_key", "expiry", "strike", "option_type", "bucket_time"],
                                    name="unique_option_oi_bucket"),
        ]
        indexes = [models.Index(fields=["index_key", "expiry", "bucket_time"])]


class OptionOIBaseline(models.Model):
    """Previous trading day's closing OI, so 'OI change' matches broker option chains."""

    index_key = models.CharField(max_length=20)
    expiry = models.DateField()
    strike = models.FloatField()
    option_type = models.CharField(max_length=2)
    trade_date = models.DateField()
    prev_oi = models.FloatField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["index_key", "expiry", "strike", "option_type", "trade_date"],
                                    name="unique_option_oi_baseline"),
        ]


class MarketNote(models.Model):
    """An admin-written 'Must know today' item, such as big news or a rule change."""

    LEVELS = (("info", "Information"), ("warning", "Be careful"), ("danger", "Risky day: turn every light red"))

    date = models.DateField(default=timezone.localdate)
    message = models.CharField(max_length=240)
    level = models.CharField(max_length=10, choices=LEVELS, default="info")

    def __str__(self):
        return f"{self.date} {self.message}"

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "Must-know note"
        verbose_name_plural = "Must-know notes"


class TraderProfile(models.Model):
    """Per-trader money rules, practice account and learner's licence."""

    LANGUAGES = (("en", "English"), ("hi", "हिन्दी"), ("kn", "ಕನ್ನಡ"))
    LEVELS = ((0, "Learner: practice money only"), (1, "Small: one lot at a time"), (2, "Standard: full money guard"))

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="trader")
    capital = models.FloatField(default=0)
    risk_per_trade_pct = models.FloatField(default=1.0)
    monthly_loss_limit = models.FloatField(default=0)
    practice_mode = models.BooleanField(default=True)
    practice_balance = models.FloatField(default=100000)
    licence_level = models.PositiveSmallIntegerField(default=0, choices=LEVELS)
    language = models.CharField(max_length=2, default="en", choices=LANGUAGES)
    telegram_chat_id = models.CharField(max_length=40, blank=True, default="")
    mentor_token = models.CharField(max_length=48, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)


class Alert(models.Model):
    """Append-only alert record. Each row's hash covers the previous row's hash, so any later edit is detectable."""

    STRENGTHS = (("strong", "Strong"), ("medium", "Medium"), ("weak", "Weak"))
    STATUSES = (("wait", "Wait"), ("confirmed", "Confirmed"))

    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    index_key = models.CharField(max_length=20)
    kind = models.CharField(max_length=20)
    strength = models.CharField(max_length=10, choices=STRENGTHS)
    status = models.CharField(max_length=10, choices=STATUSES)
    direction = models.CharField(max_length=5, blank=True, default="")
    message = models.CharField(max_length=240)
    price = models.FloatField()
    previous_hash = models.CharField(max_length=64)
    record_hash = models.CharField(max_length=64, unique=True)
    # Outcome is filled once, later, by the automatic checker; it is not part of the locked content.
    checked_at = models.DateTimeField(blank=True, null=True)
    check_price = models.FloatField(blank=True, null=True)
    outcome = models.CharField(max_length=10, blank=True, default="")

    LOCKED_FIELDS = ("created_at", "index_key", "kind", "strength", "status", "direction", "message", "price", "previous_hash", "record_hash")

    def save(self, *args, **kwargs):
        if self.pk:
            original = Alert.objects.filter(pk=self.pk).values(*self.LOCKED_FIELDS).first()
            if original and any(original[field] != getattr(self, field) for field in self.LOCKED_FIELDS):
                raise ValueError("Alerts are locked once sent and cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Alerts are locked once sent and cannot be deleted.")

    class Meta:
        ordering = ["-created_at", "-id"]


class Trade(models.Model):
    """A trader's journal entry, real or practice."""

    SIDES = (("buy", "Buy"), ("sell", "Sell"))
    EMOTIONS = (("calm", "Calm"), ("fear", "Fear"), ("greed", "Greed"), ("anger", "Anger"), ("revenge", "Winning back a loss"))

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="trades")
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(blank=True, null=True)
    practice = models.BooleanField(default=True)
    index_key = models.CharField(max_length=20, blank=True, default="")
    symbol = models.CharField(max_length=50)
    instrument = models.CharField(max_length=3, default="FUT")
    strike = models.FloatField(blank=True, null=True)
    expiry = models.DateField(blank=True, null=True)
    side = models.CharField(max_length=4, choices=SIDES)
    lots = models.PositiveIntegerField(default=1)
    lot_size = models.PositiveIntegerField(default=1)
    entry = models.FloatField()
    stop = models.FloatField(blank=True, null=True)
    exit = models.FloatField(blank=True, null=True)
    emotion = models.CharField(max_length=10, choices=EMOTIONS, default="calm")
    light_at_entry = models.CharField(max_length=6, blank=True, default="")
    checklist_ready = models.BooleanField(default=False)
    alert = models.ForeignKey(Alert, on_delete=models.SET_NULL, blank=True, null=True)
    note = models.CharField(max_length=240, blank=True, default="")

    @property
    def pnl(self):
        if self.exit is None:
            return None
        sign = 1 if self.side == "buy" else -1
        return round((self.exit - self.entry) * sign * self.lots * self.lot_size, 2)

    class Meta:
        ordering = ["-opened_at", "-id"]


class CheckIn(models.Model):
    """The three mind questions asked before the first trade of the day."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="checkins")
    date = models.DateField()
    slept_well = models.BooleanField()
    upset = models.BooleanField()
    chasing_loss = models.BooleanField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "date"], name="one_checkin_per_day")]


class TelegramSettings(models.Model):
    """Bot used to send alerts to traders who link Telegram. Create one with @BotFather."""

    bot_token = models.CharField(max_length=80, blank=True, default="")
    enabled = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Telegram settings"
        verbose_name_plural = "Telegram settings"

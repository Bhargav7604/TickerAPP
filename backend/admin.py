from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.urls import path, reverse
from django.utils import timezone
import secrets
from urllib.parse import urlencode

from kiteconnect import KiteConnect

from . import models


class TickerUserAdminForm(forms.ModelForm):
    password = forms.CharField(
        help_text="Set a login password. Leave blank when editing to keep the existing password.",
        max_length=128,
        required=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )
    valid_until = forms.DateField(
        help_text="Optional. Leave blank for no expiry.",
        required=False,
        widget=forms.DateInput(attrs={"type": "date"}),
    )

    class Meta:
        model = models.User
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._stored_password = self.instance.password
        self.initial["password"] = ""
        self.fields["password"].required = not self.instance.pk
        optional_fields = [
            "broker_username",
            "broker_password",
            "broker_twofa",
            "broker_api_key",
            "broker_api_secret",
            "broker_access_token",
        ]
        for field_name in optional_fields:
            if field_name in self.fields:
                self.fields[field_name].required = False

    def save(self, commit=True):
        user = super().save(commit=False)
        password = self.cleaned_data.get("password")
        if password:
            user.set_password(password)
        else:
            user.password = self._stored_password
        if commit:
            user.save()
            self.save_m2m()
        return user


class SMTPSettingsAdminForm(forms.ModelForm):
    password = forms.CharField(
        help_text="For Gmail, use a Google App Password. Do not use your normal Gmail password.",
        required=False,
        widget=forms.PasswordInput(render_value=True),
    )

    class Meta:
        model = models.SMTPSettings
        fields = "__all__"
        help_texts = {
            "enabled": "Turn on to let user lot swing alerts send email.",
            "host": "Gmail SMTP host is prefilled.",
            "port": "Gmail TLS port is 587.",
            "username": "Your Gmail address, for example name@gmail.com.",
            "from_email": "Optional. Leave blank to send from the Gmail username.",
            "use_tls": "Keep enabled for Gmail port 587.",
            "use_ssl": "Keep disabled for Gmail port 587.",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.instance.pk:
            self.fields["host"].initial = models.GMAIL_SMTP_HOST
            self.fields["port"].initial = models.GMAIL_SMTP_PORT
            self.fields["use_tls"].initial = True
            self.fields["use_ssl"].initial = False

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("use_tls") and cleaned_data.get("use_ssl"):
            raise forms.ValidationError("Use either TLS or SSL for SMTP, not both.")

        if not cleaned_data.get("from_email") and cleaned_data.get("username"):
            cleaned_data["from_email"] = cleaned_data["username"]

        return cleaned_data


class KiteSettingsAdminForm(forms.ModelForm):
    api_secret = forms.CharField(
        help_text="Kite Connect API secret shared by all frontend app users.",
        required=False,
        widget=forms.PasswordInput(render_value=True),
    )

    access_token = forms.CharField(
        help_text="Optional. If set, all frontend app users share this Kite session until it expires.",
        required=False,
        widget=forms.TextInput(attrs={"autocomplete": "off"}),
    )

    class Meta:
        model = models.KiteSettings
        fields = "__all__"
        help_texts = {
            "api_key": "Kite Connect API key shared by all frontend app users.",
        }


@admin.register(models.User)
class TickerUserAdmin(admin.ModelAdmin):
    form = TickerUserAdminForm
    save_on_top = True
    list_display = (
        "username",
        "valid_until",
        "is_valid",
        "contract_month",
        "alerts_enabled",
        "alert_email",
    )
    search_fields = ("username",)
    list_filter = ("contract_month", "alerts_enabled", "valid_until")
    ordering = ("username",)
    add_fieldsets = (
        ("Create App User", {
            "fields": ("username", "password", "valid_until"),
            "description": "Create a frontend app user with a fixed password.",
        }),
    )
    fieldsets = (
        ("App User Login", {
            "fields": ("username", "password", "valid_until"),
        }),
        ("Contract Selection", {
            "fields": (
                "contract_month",
            ),
        }),
    )

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return self.add_fieldsets

        return self.fieldsets

    def _is_superuser(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_module_permission(self, request):
        return self._is_superuser(request)

    def has_view_permission(self, request, obj=None):
        return self._is_superuser(request)

    def has_add_permission(self, request):
        return self._is_superuser(request)

    def has_change_permission(self, request, obj=None):
        return self._is_superuser(request)

    def has_delete_permission(self, request, obj=None):
        return self._is_superuser(request)

    @admin.display(boolean=True, description="Valid")
    def is_valid(self, obj):
        return obj.valid_until is None or obj.valid_until >= timezone.now().date()


@admin.register(models.SMTPSettings)
class SMTPSettingsAdmin(admin.ModelAdmin):
    form = SMTPSettingsAdminForm
    list_display = ("host", "port", "enabled", "from_email", "use_tls", "use_ssl", "updated_at")
    ordering = ("-updated_at",)
    fieldsets = (
        ("SMTP Server", {
            "fields": ("enabled", "host", "port", "username", "password", "from_email"),
        }),
        ("Security", {
            "fields": ("use_tls", "use_ssl"),
        }),
    )

    def has_add_permission(self, request):
        if models.SMTPSettings.objects.exists():
            return False

        return super().has_add_permission(request)

    def get_changeform_initial_data(self, request):
        return {
            "host": models.GMAIL_SMTP_HOST,
            "port": models.GMAIL_SMTP_PORT,
            "use_tls": True,
            "use_ssl": False,
            **super().get_changeform_initial_data(request),
        }


@admin.register(models.KiteSettings)
class KiteSettingsAdmin(admin.ModelAdmin):
    form = KiteSettingsAdminForm
    change_list_template = "admin/backend/kitesettings/change_list.html"
    list_display = ("has_api_key", "has_api_secret", "has_access_token", "updated_at")
    ordering = ("-updated_at",)
    fieldsets = (
        ("Kite Connect", {
            "fields": ("api_key", "api_secret", "access_token"),
            "description": "These credentials are shared by all frontend app users.",
        }),
    )

    def has_add_permission(self, request):
        if models.KiteSettings.objects.exists():
            return False

        return super().has_add_permission(request)

    def get_urls(self):
        urls = super().get_urls()
        extra = [
            path(
                "refresh-token/",
                self.admin_site.admin_view(self.refresh_token_view),
                name="backend_kitesettings_refresh_token",
            ),
        ]
        return extra + urls

    def refresh_token_view(self, request):
        if not self.has_change_permission(request):
            from django.core.exceptions import PermissionDenied
            raise PermissionDenied
        kite_settings = models.KiteSettings.objects.order_by("-updated_at", "-id").first()

        if not kite_settings or not kite_settings.api_key or not kite_settings.api_secret:
            self.message_user(
                request,
                "Set the Kite API key and API secret before refreshing the token.",
                level=messages.ERROR,
            )
            return HttpResponseRedirect(reverse("admin:backend_kitesettings_changelist"))

        kite = KiteConnect(api_key=kite_settings.api_key)
        state = secrets.token_urlsafe(32)
        request.session["kite_oauth_state"] = state
        request.session["kite_oauth_started"] = timezone.now().timestamp()
        params = urlencode({"redirect_params": urlencode({"state": state})})
        return HttpResponseRedirect(f"{kite.login_url()}&{params}")

    @admin.display(boolean=True, description="API key")
    def has_api_key(self, obj):
        return bool(obj.api_key)

    @admin.display(boolean=True, description="API secret")
    def has_api_secret(self, obj):
        return bool(obj.api_secret)

    @admin.display(boolean=True, description="Access token")
    def has_access_token(self, obj):
        return bool(obj.access_token)


@admin.register(models.MarketSnapshot)
class MarketSnapshotAdmin(admin.ModelAdmin):
    list_display = (
        "bucket_time",
        "index_key",
        "contract_month",
        "symbol",
        "instrument_type",
        "strike",
        "index_level",
        "net_lots",
        "demand_supply_ratio",
        "interval_volume",
        "source",
    )
    list_filter = ("index_key", "contract_month", "source", "bucket_time")
    search_fields = ("symbol",)
    ordering = ("-bucket_time", "index_key")
    date_hierarchy = "bucket_time"
    readonly_fields = (
        "index_key",
        "contract_month",
        "symbol",
        "instrument_type",
        "strike",
        "bucket_time",
        "index_level",
        "net_lots",
        "demand_supply_ratio",
        "volume_traded",
        "interval_volume",
        "vwap",
        "source",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


admin.site.empty_value_display = "-"
admin.site.site_header = "Ticker Admin"
admin.site.site_title = "Utraders Ticker Admin"
admin.site.index_title = "Operations Console"


@admin.register(models.MarketNote)
class MarketNoteAdmin(admin.ModelAdmin):
    list_display = ("date", "level", "message")
    list_filter = ("level", "date")
    search_fields = ("message",)


@admin.register(models.TelegramSettings)
class TelegramSettingsAdmin(admin.ModelAdmin):
    list_display = ("enabled", "updated_at")


@admin.register(models.Alert)
class AlertAdmin(admin.ModelAdmin):
    """Read-only: alerts are locked once sent."""

    list_display = ("created_at", "index_key", "kind", "strength", "status", "message", "outcome")
    list_filter = ("index_key", "strength", "status", "outcome")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

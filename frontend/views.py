from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils import timezone
from django.utils.crypto import constant_time_compare

from kiteconnect import KiteConnect

from backend.logger import log
from backend.models import KiteSettings


_OAUTH_RESULT_TEMPLATE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Zerodha session</title>
<style>
  body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fb;margin:0;padding:48px 24px;color:#101828;}}
  .card{{max-width:520px;margin:0 auto;background:#fff;border:1px solid #d9e2ec;border-radius:8px;padding:24px;box-shadow:0 8px 22px rgba(16,24,40,0.07);}}
  .card.ok{{border-color:#16b364;}} .card.err{{border-color:#d92d20;}}
  h1{{margin:0 0 8px;font-size:20px;}}
  .ok h1{{color:#067647;}} .err h1{{color:#b42318;}}
  p{{line-height:1.5;margin:8px 0;}}
  code{{background:#f2f4f7;padding:2px 6px;border-radius:4px;font-size:13px;}}
  a{{color:#1570ef;text-decoration:none;}} a:hover{{text-decoration:underline;}}
</style></head>
<body><div class="card {cls}">
  <h1>{title}</h1>
  <p>{body}</p>
  <p><a href="/admin/backend/kitesettings/">Open Kite Settings</a> &middot; <a href="/">Open dashboard</a></p>
</div></body></html>"""


def _oauth_result(success, title, body):
    cls = "ok" if success else "err"
    html = _OAUTH_RESULT_TEMPLATE.format(cls=cls, title=title, body=body)
    return HttpResponse(html, status=200 if success else 400)


@ensure_csrf_cookie
def index(request):
    request_token = request.GET.get("request_token")

    if request_token:
        expected = request.session.get("kite_oauth_state", "")
        started = request.session.get("kite_oauth_started", 0)
        if (
            not request.user.is_active or not request.user.is_staff
            or not request.user.has_perm("backend.change_kitesettings")
            or not expected or not constant_time_compare(expected, request.GET.get("state", ""))
            or not 0 <= timezone.now().timestamp() - started <= 600
        ):
            return _oauth_result(False, "Session refresh not authorised",
                "Sign in to admin and start a new token refresh from Kite Settings.")
        request.session.pop("kite_oauth_state", None)
        request.session.pop("kite_oauth_started", None)
        log(f"Kite OAuth callback received request_token (len={len(request_token)})", "INFO")
        kite_settings = KiteSettings.objects.order_by("-updated_at", "-id").first()

        if not kite_settings or not kite_settings.api_key or not kite_settings.api_secret:
            log("Kite OAuth callback: KiteSettings is missing api_key or api_secret", "ERROR")
            return _oauth_result(False, "Zerodha session NOT saved",
                "The server is missing the Kite API key or secret. Set both in "
                "<code>Admin &gt; Backend &gt; Kite Settings</code> first, then re-run the refresh.")

        try:
            kite = KiteConnect(api_key=kite_settings.api_key)
            data = kite.generate_session(request_token, kite_settings.api_secret)
            access_token = data.get("access_token")

            if not access_token:
                log(f"Kite OAuth callback: generate_session returned no access_token. payload keys={list(data.keys())}", "ERROR")
                return _oauth_result(False, "Zerodha session NOT saved",
                    "Zerodha accepted the login but did not return an access token. "
                    "Check the Kite developer-console app's API permissions.")

            kite_settings.access_token = access_token
            kite_settings.save(update_fields=["access_token", "updated_at"])
            log("Kite OAuth callback: saved a fresh access token.", "SUCCESS")

            return _oauth_result(True, "Zerodha session refreshed",
                "The market data feed will reconnect automatically. "
                "You can close this tab and return to the dashboard.")

        except Exception as exc:
            log(f"Kite OAuth callback: generate_session raised {type(exc).__name__}", "ERROR")
            return _oauth_result(False, "Zerodha session NOT saved",
                "The broker rejected the session exchange. "
                "Common causes: the API secret in the form doesn't match the API key "
                "(<code>Invalid checksum</code>), or the request token was already used "
                "(<code>Token is invalid or has expired</code>) — re-run the refresh.")

    return render(request, "index.html")

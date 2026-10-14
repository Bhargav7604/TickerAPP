import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

DEBUG = False

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "3.109.16.25",
    "ticker.quantlab.co.in",
]
ALLOWED_HOSTS.extend(
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
    if host.strip()
)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = [
    "https://ticker.quantlab.co.in",
    "https://3.109.16.25",
]
CSRF_TRUSTED_ORIGINS.extend(
    f"https://{host.strip()}"
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
    if host.strip()
)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            Path.joinpath(BASE_DIR, "templates"),
            Path.joinpath(BASE_DIR, "frontend", "gui", "build"),
        ],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# DB credentials are loaded from AWS SSM Parameter Store at service start
# (see /etc/rajesh-tickerapp/env populated by ExecStartPre on systemd unit).
# Path prefix: /rajesh-tickerapp/prod/ — db_name, db_user, db_password (SecureString),
# db_host, db_port. No secrets live in this file or in the repo anymore.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["RAJESH_TICKER_DB_NAME"],
        "USER": os.environ["RAJESH_TICKER_DB_USER"],
        "PASSWORD": os.environ["RAJESH_TICKER_DB_PASSWORD"],
        "HOST": os.environ["RAJESH_TICKER_DB_HOST"],
        "PORT": int(os.environ["RAJESH_TICKER_DB_PORT"]),
        # Reuse Postgres connections for up to 10 minutes instead of opening
        # one per request. Cuts ~10ms off every API call.
        "CONN_MAX_AGE": 600,
    }
}

STATIC_URL = "/static/"

STATICFILES_DIRS = [
    Path.joinpath(BASE_DIR, "frontend", "gui", "build", "static"),
    Path.joinpath(BASE_DIR, "frontend", "gui", "build")
]

STATIC_ROOT = Path.joinpath(BASE_DIR, "staticfiles")

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

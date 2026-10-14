from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

DEBUG = True

ALLOWED_HOSTS = []

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

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": Path.joinpath(BASE_DIR, "db.sqlite3"),
    }
}

STATIC_URL = "/static/"

STATICFILES_DIRS = [
    Path.joinpath(BASE_DIR, "frontend", "gui", "build", "static"),
    Path.joinpath(BASE_DIR, "frontend", "gui", "build"),
]

CORS_ORIGIN_WHITELIST = [
    "http://localhost:3000"
]

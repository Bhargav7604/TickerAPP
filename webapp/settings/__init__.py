import os

from .base import *

env = os.environ.get("RAJESH_SRIWASTAVA_TICKER_WEBAPP")

if env == "prod":
    from .prod import *

    # Login tokens are signed with this key; never run production on the fallback or a short key.
    if SECRET_KEY == "dev-insecure-secret-key" or len(SECRET_KEY) < 32:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY to a long random value before starting in production.")

else:
    from .dev import *

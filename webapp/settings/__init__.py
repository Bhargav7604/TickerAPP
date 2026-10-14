import os

from .base import *

env = os.environ.get("RAJESH_SRIWASTAVA_TICKER_WEBAPP")

if env == "prod":
    from .prod import *

else:
    from .dev import *

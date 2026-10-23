#!/bin/sh
set -eu

# Simple healthcheck used by CodeDeploy ValidateService hook.
# Adjust URL/port/path to match your frontend/backend health endpoint.
RETRIES=${RETRIES:-5}
SLEEP=${SLEEP:-3}
URL=${HEALTHCHECK_URL:-http://127.0.0.1:8008/}

i=0
while [ $i -lt "$RETRIES" ]; do
  if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
    echo "Healthcheck OK ($URL)"
    exit 0
  fi
  i=$((i + 1))
  echo "Healthcheck failed, attempt $i/$RETRIES. Sleeping $SLEEP..."
  sleep $SLEEP
done

echo "Healthcheck failed after $RETRIES attempts."
exit 2
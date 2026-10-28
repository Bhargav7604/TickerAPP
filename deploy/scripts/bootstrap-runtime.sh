#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-/opt/tickerapp}
ENV_FILE=${ENV_FILE:-/etc/tickerapp/env}
ECR_REGISTRY=${ECR_REGISTRY:-801949252238.dkr.ecr.ap-south-1.amazonaws.com}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

. /etc/os-release

printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" \
  > /etc/apt/sources.list.d/docker.list

apt-get update

# Remove Ubuntu Compose package if installed; it conflicts with
# Docker CE's docker-compose-plugin.
if dpkg-query -W -f='${Status}' docker-compose-v2 2>/dev/null \
  | grep -q 'install ok installed'; then
  apt-get remove -y docker-compose-v2
fi

# Repair any interrupted package configuration before continuing.
apt-get -f install -y

# Install Docker CE and its Compose plugin.
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin \
  amazon-ecr-credential-helper

install -m 0755 -d /root/.docker

cat > /root/.docker/config.json <<EOF
{
  "credHelpers": {
    "$ECR_REGISTRY": "ecr-login"
  }
}
EOF

chmod 600 /root/.docker/config.json

mkdir -p "$(dirname "$ENV_FILE")"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$APP_DIR/.env.example" ]; then
    echo "ERROR: $APP_DIR/.env.example not found; cannot create $ENV_FILE" >&2
    exit 1
  fi

  cp "$APP_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE. Configure production values before starting the stack." >&2
fi

ln -sfn "$ENV_FILE" "$APP_DIR/.env"

systemctl daemon-reload
systemctl reset-failed docker docker.socket || true
systemctl enable --now docker

docker --version
docker compose version
docker info >/dev/null

echo "Docker runtime bootstrap completed successfully."


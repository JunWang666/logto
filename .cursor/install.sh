#!/usr/bin/env bash
# Idempotent repository bootstrap for the Logto Cloud Agent environment.
# Runs after the repository is checked out. Installs stable system tools,
# refreshes JS dependencies, and generates source-derived build artifacts.
# Per-boot runtime services (Docker, Postgres, dev servers) live in start.sh
# and the dev terminal instead.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing system packages (rsync, docker, fuse-overlayfs, utilities)"
sudo apt-get update -qq
# rsync is required by @logto/core's copy:apidocs step. fuse-overlayfs lets
# Docker run nested inside the Cloud Agent VM. jq/lsof are dev conveniences.
sudo apt-get install -y -qq \
  rsync jq lsof fuse-overlayfs ca-certificates curl procps

# Docker provides the local Postgres instance used for development.
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi

# Configure the Docker daemon for the nested-container filesystem. The default
# overlay/overlayfs snapshotter cannot mount overlay-on-overlay in the VM.
echo "==> Configuring Docker daemon for nested containers"
sudo mkdir -p /etc/docker
echo '{ "storage-driver": "fuse-overlayfs", "features": { "containerd-snapshotter": false } }' \
  | sudo tee /etc/docker/daemon.json >/dev/null

echo "==> Ensuring a compatible pnpm (engines require pnpm 9 or 10)"
# The base image ships a compatible pnpm; only pin one if the active version is
# outside the supported range (e.g. corepack defaulting to pnpm 11).
pnpm_major="$(pnpm -v 2>/dev/null | cut -d. -f1 || echo 0)"
if [ "$pnpm_major" != "9" ] && [ "$pnpm_major" != "10" ]; then
  corepack prepare pnpm@10.33.3 --activate
fi

echo "==> Installing JS dependencies"
pnpm install

echo "==> Building generated artifacts (pnpm prepack)"
pnpm prepack

# Symlink built-in connectors so Core can resolve them. Filesystem-only, no DB.
echo "==> Linking connectors"
pnpm cli connector link -p .

echo "==> install.sh complete"

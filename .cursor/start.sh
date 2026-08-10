#!/usr/bin/env bash
# Per-boot runtime reconciliation for the Logto Cloud Agent environment.
# Starts the Docker daemon and the Postgres container, waits for readiness, and
# seeds the database on first boot. Idempotent and safe to re-run; it returns
# once Postgres is ready so the dev terminal can start Logto against it.
set -euo pipefail

cd "$(dirname "$0")/.."

export DB_URL="postgres://postgres:p0stgr3s@localhost:5432/logto"

echo "==> Ensuring Docker daemon is running"
if ! sudo docker info >/dev/null 2>&1; then
  sudo dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true

echo "==> Ensuring Postgres container is running"
if docker ps -a --format '{{.Names}}' | grep -qx logto-postgres; then
  docker start logto-postgres >/dev/null
else
  docker run -d --name logto-postgres -p 5432:5432 \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=p0stgr3s -e POSTGRES_DB=logto \
    postgres:17-alpine >/dev/null
fi

echo "==> Waiting for Postgres to accept connections"
for _ in $(seq 1 60); do
  docker exec logto-postgres pg_isready -U postgres -d logto >/dev/null 2>&1 && break
  sleep 1
done

# Seed only when the database has not been initialized yet.
seeded=$(docker exec logto-postgres psql -U postgres -d logto -tAc \
  "SELECT to_regclass('public.logto_configs') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]' || echo f)
if [ "$seeded" != "t" ]; then
  echo "==> Seeding database"
  pnpm cli db seed --disable-admin-pwned-password-check
else
  echo "==> Database already seeded; skipping seed"
fi

echo "==> start.sh complete (Postgres ready at $DB_URL)"

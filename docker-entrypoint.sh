#!/bin/sh
# Seed a WRITABLE /app/.env so the dashboard onboarding/settings can persist
# config. The app reads AND writes its config via src/env.ts (readEnvFile /
# updateEnvFile), and the write path uses atomicWriteFileSync -> a sibling .tmp
# + rename. A single-file bind mount can't support that (cross-device rename),
# so instead we seed a real file in the container from the read-only
# .env.docker mount (/app/.env.seed).
set -e

if [ ! -f /app/.env ]; then
  if [ -f /app/.env.seed ]; then
    cp /app/.env.seed /app/.env
  else
    : > /app/.env
  fi
fi

# Ensure the server binds all interfaces so the published port is reachable
# from the host. The app default is WEB_HOST=127.0.0.1 (container loopback
# only), which leaves the mapped port unreachable. The container network is
# isolated and /api/* stays behind the Bearer token gate.
if ! grep -q '^WEB_HOST=' /app/.env; then
  printf 'WEB_HOST=0.0.0.0\n' >> /app/.env
fi

exec "$@"

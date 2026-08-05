#!/bin/sh
# Persist the app config on the store volume so dashboard onboarding/settings
# survive container recreates.
#
# The app reads AND writes its config via src/env.ts (readEnvFile / updateEnvFile),
# and the write path uses atomicWriteFileSync -> a sibling .tmp + rename, which
# needs a real writable directory on the same filesystem (a single-file bind mount
# can't support the cross-device rename). We point the app at /app/store (a
# PERSISTENT named volume) via CLAUDECLAW_ENV_DIR, seed it once from the read-only
# .env.docker mount (/app/.env.seed), and symlink /app/.env -> the persistent copy
# so shell-side readers (scripts/channels.sh) see the same file. Nothing writes
# /app/.env directly (the app writes $CLAUDECLAW_ENV_DIR/.env), so the symlink is
# never clobbered by the atomic-rename.
set -e

ENV_DIR="${CLAUDECLAW_ENV_DIR:-/app/store}"
ENV_FILE="$ENV_DIR/.env"
mkdir -p "$ENV_DIR"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f /app/.env.seed ]; then
    cp /app/.env.seed "$ENV_FILE"
  else
    : > "$ENV_FILE"
  fi
fi

# Ensure the server binds all interfaces so the published port is reachable from
# the host. The app default is WEB_HOST=127.0.0.1 (container loopback only), which
# leaves the mapped port unreachable. The container network is isolated and /api/*
# stays behind the Bearer token gate.
if ! grep -q '^WEB_HOST=' "$ENV_FILE"; then
  printf 'WEB_HOST=0.0.0.0\n' >> "$ENV_FILE"
fi

# Shell-side readers (scripts/channels.sh) read /app/.env directly and do not honor
# CLAUDECLAW_ENV_DIR; point it at the persistent copy so both see the same config.
if [ "$ENV_FILE" != /app/.env ]; then
  ln -sf "$ENV_FILE" /app/.env
fi

exec "$@"

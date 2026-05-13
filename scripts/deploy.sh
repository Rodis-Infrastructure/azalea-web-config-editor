#!/usr/bin/env bash
# Production deploy script. Run from the azalea-editor project root after
# `git pull`. Invoked over SSH by .github/workflows/cd.yml.
#
# CI builds the UI (Monaco bundles need more RAM than the deploy host
# has) and ships `ui-dist.tar.gz` here via scp. This script extracts it
# and installs runtime-only deps, so the host never has to bundle.

set -euo pipefail

# appleboy/ssh-action runs a non-interactive non-login shell; re-add Bun
# and PM2 to PATH explicitly.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Pin the host's Bun to the version in `.bun-version` so dev/CI/prod
# stay in lockstep.
PIN="$(cat .bun-version 2>/dev/null | tr -d '[:space:]')"
if [ -n "$PIN" ]; then
  if [ "$(bun --version 2>/dev/null)" != "$PIN" ]; then
    echo "Pinning Bun to $PIN (current: $(bun --version 2>/dev/null || echo none))"
    curl -fsSL https://bun.sh/install | bash -s "bun-v$PIN"
  fi
else
  echo "WARNING: .bun-version missing; using installed Bun $(bun --version)"
fi

# Unpack the CI-built UI artifact if it's here. Falls through to a host
# build only when the tarball is absent (e.g. a manual deploy on a box
# with enough RAM).
if [ -f ui-dist.tar.gz ]; then
  echo "Using CI-built ui/dist from ui-dist.tar.gz"
  rm -rf ui/dist
  mkdir -p ui/dist
  tar -xzf ui-dist.tar.gz -C ui/dist
  rm -f ui-dist.tar.gz
  bun install --frozen-lockfile --production
else
  echo "WARNING: no ui-dist.tar.gz found; building locally."
  bun install --frozen-lockfile
  NODE_OPTIONS="--max-old-space-size=4096" bun run build
  bun run typecheck
fi

# Reload the PM2 app. --update-env propagates any new env vars.
( cd .. && pm2 reload ecosystem.config.js --only azalea-editor --update-env )

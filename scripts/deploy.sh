#!/usr/bin/env bash
# Production deploy script. Run from the azalea-editor project root after
# `git pull`. Invoked over SSH by .github/workflows/cd.yml.
#
# Two PM2 services live one directory up (~/Projects/ecosystem.config.js):
# `azalea` (the bot) and `azalea-editor` (this app). We only reload the
# editor here; the bot has its own deploy on its own repo.

set -euo pipefail

# Install everything (incl. devDeps) — Vite + tsc need them at build time.
bun install --frozen-lockfile

# Compile the React UI into ui/dist, which Hono serves in production.
bun run build

# Sanity-check the backend before reloading; tsc is fast and catches the
# bot-source-relative imports we depend on.
bun run typecheck

# Reload the PM2 app. --update-env propagates any new env vars from the
# resolved ecosystem entry (or from the parent process if launched under
# `op run`). The bot stays untouched.
( cd .. && pm2 reload ecosystem.config.js --only azalea-editor --update-env )

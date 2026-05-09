#!/usr/bin/env bash
# Production deploy script. Run from the azalea-editor project root after
# `git pull`. Invoked over SSH by .github/workflows/cd.yml.
#
# Two PM2 services live one directory up (~/Projects/ecosystem.config.js):
# `azalea` (the bot) and `azalea-editor` (this app). We only reload the
# editor here; the bot has its own deploy on its own repo.

set -euo pipefail

# appleboy/ssh-action runs a non-interactive non-login shell, so the host's
# ~/.bashrc / ~/.profile (where Bun and PM2 add themselves to PATH) is
# never sourced. Re-add both binaries' default install dirs explicitly so
# `bun` and `pm2` resolve regardless of how this script was invoked.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Keep the host's Bun current. Lockfiles are written by recent Bun in dev
# and CI; an older host Bun fails the frozen-install ("lockfile had
# changes, but lockfile is frozen"). `bun upgrade` is idempotent and
# safe when already current.
bun upgrade

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

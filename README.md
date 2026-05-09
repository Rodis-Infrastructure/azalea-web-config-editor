# azalea-editor

Web-based config editor for the [Azalea](../azalea) Discord moderation bot.

This is a sibling project — it lives next to the bot's working tree, reads and writes `azalea/configs/<guild_id>.yml`, and triggers the bot to reload via `pm2`.

## Architecture

- **Backend**: Bun + Hono, single PM2 instance. SQLite (`bun:sqlite`) for sessions and the audit log.
- **Frontend**: React 18 + Vite + Tailwind 4 + Monaco editor + react-hook-form. Source in `ui/`, builds to `ui/dist/`.
- **Auth**: Discord OAuth (`identify` + `guilds`); per-guild permission re-derivation per request mirrors the bot's `GuildConfig.hasPermission`.
- **Save pipeline**: lock → validate → mtime-check → backup → atomic write → `pm2 reload` → poll the bot's `/healthz` → two-step rollback on failure.

In dev, Vite serves the UI on `EDITOR_PORT` (default `7476`) and proxies `/api`, `/auth`, `/healthz` to Hono on `BACKEND_PORT` (default `7477`). In prod, only Hono runs — it serves both the API and the built `ui/dist`.

## Setup

```sh
cp .env.example .env
# fill in DISCORD_CLIENT_ID / SECRET / REDIRECT_URI / TOKEN / SESSION_SECRET / AZALEA_REPO_PATH
bun install

# Dev — Vite + HMR on EDITOR_PORT, Hono on BACKEND_PORT, proxied together.
op run --env-file=.env -- bun run dev
# Or if .env contains literal secrets:
bun run dev

# Production — single Hono process serves API + built UI on EDITOR_PORT.
bun run build
op run --env-file=.env -- bun start
```

The bot must be running with the `/healthz` endpoint available (Bun.serve on `127.0.0.1:7475` by default — see `azalea/src/utils/health.ts`).

Open `http://127.0.0.1:7476` once the editor is up. Sign in with Discord, pick a guild, edit the YAML or use the structured Permissions form, save.

## Bootstrap

A fresh guild config has no role granting `manage_guild_config`, so the editor will refuse access until one is configured. Set `BOOTSTRAP_USER_IDS` to your Discord user ID, log in, grant `manage_guild_config` to a staff role, then unset the env var.

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start the server in watch mode. |
| `bun start` | Start the server (production). |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun test` | Run unit tests. |

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/auth/login` | 302 to Discord OAuth |
| `GET` | `/auth/callback` | Code exchange, sets session |
| `POST` | `/auth/logout` | Destroys session |
| `GET` | `/api/me` | Identity + manageable guilds |
| `GET` | `/api/health` | Proxies the bot's `/healthz` for the version-drift banner |
| `GET` | `/api/guilds/:guildId/config` | Current YAML + parse + mtime |
| `POST` | `/api/guilds/:guildId/config/validate` | Server-side `safeParse` |
| `POST` | `/api/guilds/:guildId/config` | Save pipeline (validate, write, reload, verify, rollback) |
| `GET` | `/api/guilds/:guildId/config/backups` | List backups |
| `POST` | `/api/guilds/:guildId/config/restore` | Restore a backup |
| `GET` | `/api/guilds/:guildId/discord/{channels,roles,emojis}` | Bot-token-backed proxy with 30s cache |
| `GET` | `/api/guilds/:guildId/audit` | Audit log |

## Safety notes

- Never imports `GuildConfig` or `ConfigManager` from the bot — both call `process.exit(1)` on validation failure. Always uses `rawGuildConfigSchema.safeParse` directly.
- Always triggers a full `pm2 reload`. In-place hot-swap via `addGuildConfig` would leak cron jobs (scheduled messages, review reminders, report removal).
- Bind `127.0.0.1` only; front with a reverse proxy that terminates TLS.

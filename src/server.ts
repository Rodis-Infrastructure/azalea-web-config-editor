/**
 * Editor server entry. Validates env, mounts routes, binds to loopback.
 *
 * Always front this with a reverse proxy that terminates TLS — the editor
 * binds 127.0.0.1 by default and never speaks plaintext to the public
 * internet.
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { assertRuntimeEnv, env } from "@lib/env";
import { authRoutes } from "@/routes/auth";
import { meRoutes } from "@/routes/me";
import { configRoutes } from "@/routes/config";
import { discordRoutes } from "@/routes/discord";
import { auditRoutes } from "@/routes/audit";
import { healthRoutes } from "@/routes/health";
import { sessionMiddleware } from "@/middleware/session";
import { purgeExpiredSessions } from "@lib/session";
import { getDb } from "@lib/db";

assertRuntimeEnv();
getDb();
purgeExpiredSessions();

const PROJECT_ROOT = resolve(import.meta.dir, "..");
// Production: Hono serves the Vite-built React app from ui/dist. In dev,
// these paths simply don't exist — Vite handles UI and proxies API calls
// here, so the SPA fallback below is unused.
const UI_DIST = resolve(PROJECT_ROOT, "ui", "dist");
const UI_INDEX = resolve(UI_DIST, "index.html");

const app = new Hono();
app.use("*", logger());

app.get("/healthz", c => c.json({ ok: true }));

app.use("/api/*", sessionMiddleware);

app.route("/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/api/health", healthRoutes);
app.route("/api/guilds/:guildId/config", configRoutes);
app.route("/api/guilds/:guildId/discord", discordRoutes);
app.route("/api/guilds/:guildId/audit", auditRoutes);

// SPA assets — Hono serves ui/dist in production. In dev, BACKEND_PORT
// runs Hono on its own port and Vite handles the UI; these handlers
// effectively never fire because Vite proxies the API/auth routes here
// without ever asking the backend for HTML.
app.get("/assets/*", c => {
	const rel = c.req.path.replace(/^\//, "");
	const target = resolve(UI_DIST, rel);
	if (!target.startsWith(UI_DIST + "/") || !existsSync(target)) {
		return c.text("Not found", 404);
	}
	return new Response(Bun.file(target));
});

app.get("*", c => {
	if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
	if (!existsSync(UI_INDEX)) {
		return c.text(
			"UI not built. Run `bun run build` for production, or `bun run dev` for the Vite dev server.",
			500
		);
	}
	return new Response(Bun.file(UI_INDEX));
});

const server = Bun.serve({
	hostname: env.editorHost,
	port: env.backendPort,
	fetch: app.fetch
});

console.log(`azalea-editor listening on http://${server.hostname}:${server.port}`);

// Sweep expired sessions hourly.
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

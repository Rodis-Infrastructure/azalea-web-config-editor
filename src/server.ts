/**
 * Editor server entry. Validates env, mounts routes, binds to loopback.
 *
 * Always front this with a reverse proxy that terminates TLS — the editor
 * binds 127.0.0.1 by default and never speaks plaintext to the public
 * internet.
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { resolve, sep } from "node:path";
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
import { purgeOldAuditBlobs } from "@lib/audit";
import { getDb } from "@lib/db";

assertRuntimeEnv();
getDb();
purgeExpiredSessions();
purgeOldAuditBlobs(env.auditBlobRetentionDays);

const PROJECT_ROOT = resolve(import.meta.dir, "..");
// Production: Hono serves the Vite-built React app from ui/dist. In dev,
// these paths simply don't exist — Vite handles UI and proxies API calls
// here, so the SPA fallback below is unused.
const UI_DIST = resolve(PROJECT_ROOT, "ui", "dist");
const UI_INDEX = resolve(UI_DIST, "index.html");

const app = new Hono();
app.use("*", logger());

/**
 * Baseline security headers applied to every response. Each one closes a
 * specific gap rather than a vague "defense in depth":
 *
 * - X-Frame-Options: DENY — refuses to render the editor in any iframe,
 *   so a malicious page can't load it cookie-bearing and clickjack the
 *   Save button. (Browsers ignore the cookie for cross-site iframe
 *   subresources thanks to SameSite=Lax, but this keeps the page from
 *   even rendering visually.)
 *
 * - X-Content-Type-Options: nosniff — stops browsers from MIME-sniffing
 *   the YAML payloads we serve as application/json into a script context.
 *
 * - Referrer-Policy: same-origin — keeps the editor's URLs (including
 *   guild IDs in the path) from leaking to third parties when a user
 *   clicks an external link from inside a config.
 *
 * - Content-Security-Policy — locks the page to same-origin scripts and
 *   styles, allows `blob:` workers for Monaco's tokenizer, allows
 *   inline styles (Monaco injects them at runtime), permits Discord's
 *   CDN for guild icons, and blocks everything else (objects, frames,
 *   form posts to other origins).
 */
const SECURITY_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data:",
	"img-src 'self' data: https://cdn.discordapp.com",
	"worker-src 'self' blob:",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'"
].join("; ");

function applySecurityHeaders(c: { header: (k: string, v: string) => void }): void {
	c.header("X-Frame-Options", "DENY");
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Referrer-Policy", "same-origin");
	c.header("Content-Security-Policy", SECURITY_CSP);
}

// `try/finally` so the headers land on every response — including error
// responses synthesized by Hono after a route handler throws. Without
// the `finally`, an exception in `next()` would skip the header-setting
// block entirely and the 500 response would leave the page exposed.
app.use("*", async (c, next) => {
	try {
		await next();
	} finally {
		applySecurityHeaders(c);
	}
});

// Hono's default error handler runs *outside* the middleware chain when
// a downstream throw escapes, so re-apply the headers there too as a
// belt-and-braces measure against future refactors that drop the
// `finally` above.
app.onError((err, c) => {
	console.error("unhandled error:", err);
	applySecurityHeaders(c);
	return c.json({ error: "internal_error" }, 500);
});

app.get("/healthz", c => c.json({ ok: true }));

// Cap every body-bearing route at 1 MiB. The largest legitimate payload is a
// guild YAML config; real-world configs run a few hundred KiB at most. The
// limit defends the editor from a single oversized JSON body OOM'ing the
// process before any route handler validates the shape. `/auth/*` shares
// the cap so future POSTs under that prefix don't accidentally bypass it.
const MAX_BODY_BYTES = 1 * 1024 * 1024;
const bodyLimitMiddleware = bodyLimit({
	maxSize: MAX_BODY_BYTES,
	onError: c => c.json({ error: "payload_too_large" }, 413)
});
app.use("/api/*", bodyLimitMiddleware);
app.use("/auth/*", bodyLimitMiddleware);

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
	if (!target.startsWith(UI_DIST + sep) || !existsSync(target)) {
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

// Sweep expired sessions and age out audit blobs hourly. Both are cheap
// SQL writes; running them together keeps the timer count down.
setInterval(() => {
	purgeExpiredSessions();
	purgeOldAuditBlobs(env.auditBlobRetentionDays);
}, 60 * 60 * 1000).unref();

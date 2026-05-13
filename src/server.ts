// Front this with a TLS-terminating reverse proxy — the editor binds
// 127.0.0.1 by default and speaks plaintext.
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
const UI_DIST = resolve(PROJECT_ROOT, "ui", "dist");
const UI_INDEX = resolve(UI_DIST, "index.html");

const app = new Hono();
app.use("*", logger());

// Monaco needs `'unsafe-eval'` for its Monarch tokenizer (compiles regex
// rules via `new Function`) and `blob:` for its web workers. We
// self-host Monaco (see ui/src/monaco-setup.ts), so no third-party
// script source is allowed — only `'self'` plus the necessary
// eval/blob escape hatches.
const SECURITY_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval' blob:",
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

// `finally` so headers land on error responses too. `onError` re-applies
// in case Hono's error path ever bypasses middleware unwinding.
app.use("*", async (c, next) => {
	try {
		await next();
	} finally {
		applySecurityHeaders(c);
	}
});

app.onError((err, c) => {
	console.error("unhandled error:", err);
	applySecurityHeaders(c);
	return c.json({ error: "internal_error" }, 500);
});

app.get("/healthz", c => c.json({ ok: true }));

// Configs run a few hundred KiB; 1 MiB is a safe ceiling.
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

// Hono drops Bun.file's implicit Content-Type, which combined with
// nosniff makes browsers download instead of render. Set it explicitly.
function fileResponse(path: string): Response {
	const file = Bun.file(path);
	return new Response(file, {
		headers: { "Content-Type": file.type || "application/octet-stream" }
	});
}

app.get("/assets/*", c => {
	const rel = c.req.path.replace(/^\//, "");
	const target = resolve(UI_DIST, rel);
	if (!target.startsWith(UI_DIST + sep) || !existsSync(target)) {
		return c.text("Not found", 404);
	}
	return fileResponse(target);
});

app.get("*", c => {
	if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
	if (!existsSync(UI_INDEX)) {
		return c.text(
			"UI not built. Run `bun run build` for production, or `bun run dev` for the Vite dev server.",
			500
		);
	}
	return fileResponse(UI_INDEX);
});

const server = Bun.serve({
	hostname: env.editorHost,
	port: env.backendPort,
	fetch: app.fetch
});

console.log(`azalea-editor listening on http://${server.hostname}:${server.port}`);

setInterval(() => {
	purgeExpiredSessions();
	purgeOldAuditBlobs(env.auditBlobRetentionDays);
}, 60 * 60 * 1000).unref();

/**
 * GET /api/health → proxies the bot's /healthz so the browser can detect
 * version drift (deploy mid-edit-session) without itself reaching the
 * loopback-bound bot endpoint.
 *
 * Returns the same shape the bot exposes: { ready, pid, startedAt, name,
 * version }, plus an `ok: false` envelope when the bot is unreachable.
 */
import { Hono } from "hono";
import { sessionMiddleware, requireSession, type SessionEnv } from "@/middleware/session";
import { fetchHealth } from "@lib/healthcheck";

export const healthRoutes = new Hono<SessionEnv>()
	.use("*", sessionMiddleware, requireSession);

healthRoutes.get("/", async c => {
	const snap = await fetchHealth();
	if (!snap) {
		return c.json({ ok: false, reason: "unreachable" }, 502);
	}
	return c.json({ ok: true, ...snap });
});

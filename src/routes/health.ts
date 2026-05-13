// GET /api/health proxies the bot's /healthz so the browser can detect
// version drift. The bot itself binds to loopback only.
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

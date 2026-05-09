/**
 * Audit log read endpoint. Per-guild filtering and a default cap of 100
 * rows; frontend can paginate via `?limit=`.
 */
import { Hono } from "hono";
import { sessionMiddleware } from "@/middleware/session";
import { guildAuthMiddleware, type GuildAuthEnv } from "@/middleware/guildAuth";
import { listAuditEvents } from "@lib/audit";

export const auditRoutes = new Hono<GuildAuthEnv>()
	.use("*", sessionMiddleware, guildAuthMiddleware);

auditRoutes.get("/", c => {
	const guildId = c.get("guildId");
	const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 500);
	return c.json({ events: listAuditEvents(guildId, limit) });
});

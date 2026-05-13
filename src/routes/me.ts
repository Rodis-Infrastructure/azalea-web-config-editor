// GET /api/me — identity plus the subset of on-disk guilds the user
// can edit, derived via authorizeGuildEdit.
import { Hono } from "hono";
import { authorizeGuildEdit } from "@lib/auth";
import { fetchGuild } from "@lib/discord";
import { listGuildIds, readConfigFile, validateConfigYaml } from "@lib/config";
import type { RawGuildConfig } from "@/schema";
import { sessionMiddleware, requireSession, type SessionEnv } from "@/middleware/session";
import { env } from "@lib/env";

interface ManageableGuild {
	id: string;
	name: string;
	icon: string | null;
	via: "bootstrap" | "permission";
}

export const meRoutes = new Hono<SessionEnv>().use("*", sessionMiddleware, requireSession);

meRoutes.get("/", async c => {
	const session = c.get("session")!;
	const guildIds = listGuildIds();
	const manageable: ManageableGuild[] = [];

	for (const guildId of guildIds) {
		const file = readConfigFile(guildId);
		const validation = file ? validateConfigYaml(file.yamlText) : null;
		const config: RawGuildConfig | null = validation?.ok
			? (validation.parsed as RawGuildConfig)
			: null;

		const decision = await authorizeGuildEdit(session.userId, guildId, config);
		if (!decision.allowed) continue;

		const summary = await fetchGuild(guildId).catch(() => null);
		if (!summary) continue;

		manageable.push({
			id: guildId,
			name: summary.name,
			icon: summary.icon,
			via: decision.via
		});
	}

	return c.json({
		userId: session.userId,
		username: session.username,
		manageableGuilds: manageable,
		testWebhookConfigured: env.testWebhookUrl !== ""
	});
});

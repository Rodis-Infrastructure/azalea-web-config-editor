/**
 * GET /api/me → identity + manageable guilds.
 *
 * Walks every guild that has a config file on disk, runs the same
 * permission check the per-guild routes use, and returns only those
 * the current user can edit. The check uses the bot token to fetch
 * the user's member object (so we never need the user's OAuth access
 * token after callback) and mirrors the bot's `GuildConfig.hasPermission`.
 */
import { Hono } from "hono";
import { authorizeGuildEdit } from "@lib/auth";
import { fetchGuild } from "@lib/discord";
import { listGuildIds, readConfigFile, validateConfigYaml } from "@lib/config";
import type { RawGuildConfig } from "@/schema";
import { sessionMiddleware, requireSession, type SessionEnv } from "@/middleware/session";

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
		manageableGuilds: manageable
	});
});

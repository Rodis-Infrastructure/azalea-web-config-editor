// Re-derives the permission decision per request (no caching) from the
// live config + member roles.
import { createMiddleware } from "hono/factory";
import { authorizeGuildEdit } from "@lib/auth";
import { readConfigFile, validateConfigYaml } from "@lib/config";
import type { RawGuildConfig } from "@/schema";
import type { SessionEnv } from "@/middleware/session";

export type GuildAuthEnv = SessionEnv & {
	Variables: SessionEnv["Variables"] & {
		guildId: string;
		guildAuth: { via: "bootstrap" | "permission" };
	};
};

export const guildAuthMiddleware = createMiddleware<GuildAuthEnv>(async (c, next) => {
	const session = c.get("session");
	if (!session) return c.json({ error: "unauthenticated" }, 401);

	const guildId = c.req.param("guildId");
	if (!guildId || !/^\d{17,19}$/.test(guildId)) {
		return c.json({ error: "invalid_guild_id" }, 400);
	}

	const file = readConfigFile(guildId);
	const validation = file ? validateConfigYaml(file.yamlText) : null;
	const config: RawGuildConfig | null = validation?.ok
		? (validation.parsed as RawGuildConfig)
		: null;

	const decision = await authorizeGuildEdit(session.userId, guildId, config);
	if (!decision.allowed) {
		return c.json({ error: "forbidden", reason: decision.reason }, 403);
	}

	c.set("guildId", guildId);
	c.set("guildAuth", { via: decision.via });
	return next();
});

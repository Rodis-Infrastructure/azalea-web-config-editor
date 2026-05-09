/**
 * Read-only proxy routes for Discord guild metadata. The frontend pickers
 * use these to populate channel / role / emoji dropdowns. Cached
 * server-side for 30s in-memory (see `lib/discord.ts`).
 */
import { Hono } from "hono";
import { sessionMiddleware } from "@/middleware/session";
import { guildAuthMiddleware, type GuildAuthEnv } from "@/middleware/guildAuth";
import { listChannels, listEmojis, listRoles } from "@lib/discord";

export const discordRoutes = new Hono<GuildAuthEnv>()
	.use("*", sessionMiddleware, guildAuthMiddleware);

discordRoutes.get("/channels", async c => {
	const channels = await listChannels(c.get("guildId"));
	return c.json(channels);
});

discordRoutes.get("/roles", async c => {
	const roles = await listRoles(c.get("guildId"));
	return c.json(roles);
});

discordRoutes.get("/emojis", async c => {
	const emojis = await listEmojis(c.get("guildId"));
	return c.json(emojis);
});

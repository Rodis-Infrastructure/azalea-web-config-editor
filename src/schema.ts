/**
 * Schema re-exports from the bot. The editor and the bot must validate
 * configs against the *exact* same Zod schema, so we import directly from
 * the bot's source via a relative path rather than duplicating or
 * extracting to a shared package.
 *
 * IMPORTANT: only `rawGuildConfigSchema`, `globalConfigSchema`, the
 * `Permission` enum, and the type aliases are safe to import from the bot.
 *
 * `GuildConfig` and `ConfigManager` both call `process.exit(1)` on
 * validation failure (six call sites between them) — importing those would
 * cause a malformed save to kill the editor process. Always use
 * `rawGuildConfigSchema.safeParse` directly here and format errors locally.
 */
export {
	rawGuildConfigSchema,
	globalConfigSchema,
	Permission
} from "@bot/managers/config/schema";

export type {
	RawGuildConfig,
	GlobalConfig
} from "@bot/managers/config/schema";

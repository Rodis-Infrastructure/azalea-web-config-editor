// Only re-export the schema/enum from the bot. Never import the bot's
// `GuildConfig` / `ConfigManager` — they `process.exit(1)` on schema
// failure, which would kill the editor.
export {
	rawGuildConfigSchema,
	globalConfigSchema,
	Permission
} from "@bot/managers/config/schema";

export type {
	RawGuildConfig,
	GlobalConfig
} from "@bot/managers/config/schema";

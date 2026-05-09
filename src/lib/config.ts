/**
 * Read/write helpers for the bot's `configs/<guild>.yml` files.
 *
 * Crucially, this module never imports the bot's `ConfigManager` or
 * `GuildConfig` — both call `process.exit(1)` on validation failure, which
 * would crash the editor. We use `rawGuildConfigSchema.safeParse` directly
 * and surface errors back to the caller.
 */
import { existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as yamlParse } from "yaml";
import { rawGuildConfigSchema } from "@/schema";
import { env } from "@lib/env";

export interface ConfigFile {
	guildId: string;
	yamlText: string;
	mtimeMs: number;
}

export interface ParsedConfigFile extends ConfigFile {
	parsed: unknown;
}

/** Returns the absolute path to a guild's config file. */
export function configPath(guildId: string): string {
	if (!/^\d{17,19}$/.test(guildId)) {
		throw new Error(`Refusing to resolve config path for non-snowflake guildId: ${guildId}`);
	}
	return resolve(env.configsDir, `${guildId}.yml`);
}

/** List the guild IDs that currently have a config file on disk. */
export function listGuildIds(): string[] {
	if (!existsSync(env.configsDir)) return [];
	return readdirSync(env.configsDir)
		.filter(name => /^\d{17,19}\.ya?ml$/.test(name))
		.map(name => name.replace(/\.ya?ml$/, ""));
}

/** Returns null if the file doesn't exist. Throws on read errors. */
export function readConfigFile(guildId: string): ConfigFile | null {
	const path = configPath(guildId);
	if (!existsSync(path)) return null;

	const yamlText = readFileSync(path, "utf8");
	const stat = statSync(path);

	return { guildId, yamlText, mtimeMs: stat.mtimeMs };
}

/**
 * Atomically write a guild's config file. Caller is responsible for
 * pre-flight validation (`safeParse`) — this function only verifies that
 * the YAML parses; it does not enforce schema rules.
 */
export function writeConfigFileAtomic(guildId: string, yamlText: string): void {
	// Sanity check that the text parses as YAML at all. This catches the
	// "user typed gibberish in the raw editor and clicked save" case before
	// it reaches the bot.
	yamlParse(yamlText);

	const path = configPath(guildId);
	const tmpPath = `${path}.tmp`;
	mkdirSync(env.configsDir, { recursive: true });
	writeFileSync(tmpPath, yamlText, "utf8");
	renameSync(tmpPath, path);
}

/**
 * Backup the current config file (if any) under
 * `<configs>/.backups/<guildId>/<UTC-iso>.yml`. Rotates to keep the most
 * recent {@link RETAIN} files.
 */
const RETAIN = 20;

export function backupConfigFile(guildId: string): string | null {
	const path = configPath(guildId);
	if (!existsSync(path)) return null;

	const dir = join(env.backupsDir, guildId);
	mkdirSync(dir, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = join(dir, `${stamp}.yml`);
	writeFileSync(backupPath, readFileSync(path, "utf8"), "utf8");

	rotate(dir);
	return backupPath;
}

function rotate(dir: string): void {
	const entries = readdirSync(dir)
		.filter(name => name.endsWith(".yml"))
		.map(name => ({ name, path: join(dir, name) }))
		.sort((a, b) => b.name.localeCompare(a.name)); // Newest first (ISO8601 sorts lexically)

	for (const entry of entries.slice(RETAIN)) {
		try {
			renameSync(entry.path, `${entry.path}.deleted`);
			// Best-effort delete; if it fails we just leave the .deleted file.
			Bun.file(`${entry.path}.deleted`).delete().catch(() => undefined);
		} catch {
			// Ignore rotation failures — they don't affect correctness of the save.
		}
	}
}

/** List the available backups for a guild, newest first. */
export function listBackups(guildId: string): { stamp: string; path: string }[] {
	const dir = join(env.backupsDir, guildId);
	if (!existsSync(dir)) return [];

	return readdirSync(dir)
		.filter(name => name.endsWith(".yml"))
		.sort((a, b) => b.localeCompare(a))
		.map(name => ({
			stamp: name.replace(/\.yml$/, ""),
			path: join(dir, name)
		}));
}

/** Read a specific backup file's contents by timestamp. */
export function readBackup(guildId: string, stamp: string): string | null {
	const dir = join(env.backupsDir, guildId);
	const path = join(dir, `${stamp}.yml`);
	if (!existsSync(path)) return null;
	return readFileSync(path, "utf8");
}

/**
 * Validate raw YAML text against `rawGuildConfigSchema`. Returns a
 * uniform shape so callers can render Zod issues to JSON-pointer paths.
 */
export function validateConfigYaml(yamlText: string): {
	ok: true;
	parsed: unknown;
} | {
	ok: false;
	stage: "yaml" | "schema";
	errors: { path: string; message: string }[];
} {
	let parsed: unknown;
	try {
		parsed = yamlParse(yamlText);
	} catch (err) {
		return {
			ok: false,
			stage: "yaml",
			errors: [{ path: "", message: err instanceof Error ? err.message : String(err) }]
		};
	}

	const result = rawGuildConfigSchema.safeParse(parsed);
	if (!result.success) {
		return {
			ok: false,
			stage: "schema",
			errors: result.error.issues.map(issue => ({
				path: issue.path.map(p => String(p)).join("."),
				message: issue.message
			}))
		};
	}

	return { ok: true, parsed: result.data };
}

/** Convenience type re-export for callers wiring up routes. */
export type ConfigValidationResult = ReturnType<typeof validateConfigYaml>;

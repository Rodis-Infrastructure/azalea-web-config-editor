/**
 * Read/write helpers for the bot's `configs/<guild>.yml` files.
 *
 * Crucially, this module never imports the bot's `ConfigManager` or
 * `GuildConfig` — both call `process.exit(1)` on validation failure, which
 * would crash the editor. We use `rawGuildConfigSchema.safeParse` directly
 * and surface errors back to the caller.
 */
import { existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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

/**
 * Snowflake regex applied to every `guildId` before it touches the
 * filesystem. Exported so author-sidecar helpers can enforce the same
 * invariant locally without depending on every caller having gone
 * through the guild-auth middleware first.
 */
const GUILD_ID_RE = /^\d{17,19}$/;

function assertGuildId(guildId: string): void {
	if (!GUILD_ID_RE.test(guildId)) {
		throw new Error(`Refusing to resolve path for non-snowflake guildId: ${guildId}`);
	}
}

/** Returns the absolute path to a guild's config file. */
export function configPath(guildId: string): string {
	assertGuildId(guildId);
	return resolve(env.configsDir, `${guildId}.yml`);
}

/**
 * Sidecar tracking who last saved the live config. Written alongside the
 * `.yml` on every successful save and copied into the backup directory when
 * we rotate the file, so backups can name their author without joining
 * against the audit log.
 */
export interface BackupAuthor {
	userId: string;
	username: string;
	savedAt: number;
}

function authorSidecarPath(guildId: string): string {
	assertGuildId(guildId);
	return resolve(env.configsDir, ".authors", `${guildId}.json`);
}

function readAuthor(path: string): BackupAuthor | null {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BackupAuthor>;
		if (typeof parsed.userId !== "string" || typeof parsed.username !== "string") return null;
		return {
			userId: parsed.userId,
			username: parsed.username,
			savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0
		};
	} catch {
		return null;
	}
}

export function readCurrentAuthor(guildId: string): BackupAuthor | null {
	return readAuthor(authorSidecarPath(guildId));
}

export function writeCurrentAuthor(guildId: string, author: BackupAuthor): void {
	const path = authorSidecarPath(guildId);
	mkdirSync(resolve(path, ".."), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(author), "utf8");
	renameSync(tmp, path);
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

	// Capture the author of the content we just snapshotted so the editor can
	// display "saved by X" against each backup.
	const author = readCurrentAuthor(guildId);
	if (author) {
		writeFileSync(join(dir, `${stamp}.author.json`), JSON.stringify(author), "utf8");
	}

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
			// Best-effort cleanup of the matching author sidecar.
			const stamp = entry.name.replace(/\.yml$/, "");
			const sidecar = join(dir, `${stamp}.author.json`);
			if (existsSync(sidecar)) {
				try { Bun.file(sidecar).delete().catch(() => undefined); }
				catch { /* ignore */ }
			}
		} catch {
			// Ignore rotation failures — they don't affect correctness of the save.
		}
	}
}

/** List the available backups for a guild, newest first. */
export function listBackups(guildId: string): { stamp: string; path: string; author: BackupAuthor | null }[] {
	const dir = join(env.backupsDir, guildId);
	if (!existsSync(dir)) return [];

	return readdirSync(dir)
		.filter(name => name.endsWith(".yml"))
		.sort((a, b) => b.localeCompare(a))
		.map(name => {
			const stamp = name.replace(/\.yml$/, "");
			return {
				stamp,
				path: join(dir, name),
				author: readAuthor(join(dir, `${stamp}.author.json`))
			};
		});
}

/**
 * Backup stamps are always generated by {@link backupConfigFile} as an
 * ISO-8601 timestamp with `:` / `.` replaced by `-`. We pin the allowed
 * shape here so a caller-supplied `stamp` can never break out of the
 * guild's backup directory via `..` or absolute-path tricks.
 */
const BACKUP_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z$/;

/** Read a specific backup file's contents by timestamp. */
export function readBackup(guildId: string, stamp: string): string | null {
	assertGuildId(guildId);
	if (!BACKUP_STAMP_RE.test(stamp)) return null;
	const dir = resolve(env.backupsDir, guildId);
	const path = resolve(dir, `${stamp}.yml`);
	// Belt and braces: even though the regex precludes traversal, assert the
	// resolved path actually lives inside the per-guild backup directory
	// before reading. `path.sep` covers Windows hosts; on Linux it's `/`.
	if (!path.startsWith(dir + sep)) return null;
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

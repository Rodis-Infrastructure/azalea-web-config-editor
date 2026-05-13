// Never import the bot's `ConfigManager` / `GuildConfig`: both call
// `process.exit(1)` on schema failure. Use `rawGuildConfigSchema.safeParse`
// directly so a bad config can't kill the editor.
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

const GUILD_ID_RE = /^\d{17,19}$/;

function assertGuildId(guildId: string): void {
	if (!GUILD_ID_RE.test(guildId)) {
		throw new Error(`Refusing to resolve path for non-snowflake guildId: ${guildId}`);
	}
}

export function configPath(guildId: string): string {
	assertGuildId(guildId);
	return resolve(env.configsDir, `${guildId}.yml`);
}

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

export function listGuildIds(): string[] {
	if (!existsSync(env.configsDir)) return [];
	return readdirSync(env.configsDir)
		.filter(name => /^\d{17,19}\.ya?ml$/.test(name))
		.map(name => name.replace(/\.ya?ml$/, ""));
}

export function readConfigFile(guildId: string): ConfigFile | null {
	const path = configPath(guildId);
	if (!existsSync(path)) return null;

	const yamlText = readFileSync(path, "utf8");
	const stat = statSync(path);

	return { guildId, yamlText, mtimeMs: stat.mtimeMs };
}

// Caller is responsible for schema validation; this only checks the
// text parses as YAML before we hand it to the bot.
export function writeConfigFileAtomic(guildId: string, yamlText: string): void {
	yamlParse(yamlText);

	const path = configPath(guildId);
	const tmpPath = `${path}.tmp`;
	mkdirSync(env.configsDir, { recursive: true });
	writeFileSync(tmpPath, yamlText, "utf8");
	renameSync(tmpPath, path);
}

const RETAIN = 20;

export function backupConfigFile(guildId: string): string | null {
	const path = configPath(guildId);
	if (!existsSync(path)) return null;

	const dir = join(env.backupsDir, guildId);
	mkdirSync(dir, { recursive: true });

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = join(dir, `${stamp}.yml`);
	writeFileSync(backupPath, readFileSync(path, "utf8"), "utf8");

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
		.sort((a, b) => b.name.localeCompare(a.name)); // ISO8601 sorts lexically

	for (const entry of entries.slice(RETAIN)) {
		try {
			renameSync(entry.path, `${entry.path}.deleted`);
			Bun.file(`${entry.path}.deleted`).delete().catch(() => undefined);
			const stamp = entry.name.replace(/\.yml$/, "");
			const sidecar = join(dir, `${stamp}.author.json`);
			if (existsSync(sidecar)) {
				try { Bun.file(sidecar).delete().catch(() => undefined); }
				catch { /* ignore */ }
			}
		} catch {
			// Rotation failure doesn't affect save correctness.
		}
	}
}

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

// Stamp shape matches what backupConfigFile generates — anything else
// can't have come from us and could be a traversal attempt.
const BACKUP_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z$/;

export function readBackup(guildId: string, stamp: string): string | null {
	assertGuildId(guildId);
	if (!BACKUP_STAMP_RE.test(stamp)) return null;
	const dir = resolve(env.backupsDir, guildId);
	const path = resolve(dir, `${stamp}.yml`);
	if (!path.startsWith(dir + sep)) return null;
	if (!existsSync(path)) return null;
	return readFileSync(path, "utf8");
}

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

export type ConfigValidationResult = ReturnType<typeof validateConfigYaml>;

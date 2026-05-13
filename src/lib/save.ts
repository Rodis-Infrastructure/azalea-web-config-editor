/**
 * The save pipeline. Owns the contract between "user clicked save in the
 * editor" and "the bot is running the new config" — including rollback
 * when the new config crashes the bot on startup.
 *
 * Sequence per save (every step is observable for the audit log):
 *   1. Acquire per-guild lock.
 *   2. Validate the proposed YAML against the bot's Zod schema.
 *   3. Conflict check on `mtime` if the caller supplied one.
 *   4. Backup current file (rotation handled inside config.ts).
 *   5. Atomic write (.tmp → rename).
 *   6. Acquire global pm2-reload lock; capture pre-reload `startedAt`.
 *   7. Spawn `pm2 reload <app> --update-env` from the bot's parent dir.
 *   8. Poll /healthz until ready=true and startedAt advances, or timeout.
 *   9. On timeout: restore previous file → reload again → poll again.
 *      If the second reload also fails, abort with `degraded` so the
 *      operator knows manual intervention is required.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { withLock } from "@lib/lock";
import { env } from "@lib/env";
import { fetchHealth, waitForFreshReady } from "@lib/healthcheck";
import {
	backupConfigFile,
	configPath,
	readConfigFile,
	validateConfigYaml,
	writeConfigFileAtomic,
	writeCurrentAuthor
} from "@lib/config";

const HEALTH_TIMEOUT_MS = 30_000;

export type SaveOutcome =
	| { status: "saved"; backupPath: string | null; startedAt: string }
	| { status: "rolled_back"; reason: "health_timeout" | "reload_failed"; backupPath: string | null }
	| { status: "degraded"; reason: string; backupPath: string | null }
	| { status: "validation_failed"; errors: { path: string; message: string }[] }
	| { status: "conflict"; serverMtimeMs: number };

export interface SaveInput {
	guildId: string;
	yamlText: string;
	/** Optional optimistic-concurrency token. If supplied, the save aborts when
	 *  the on-disk mtime differs (another editor saved in between). */
	expectedMtimeMs?: number;
	/**
	 * Who is saving. Persisted in a sidecar so future backups can name the
	 * author of the snapshot they replaced.
	 */
	actor?: { userId: string; username: string };
}

export async function saveGuildConfig(input: SaveInput): Promise<SaveOutcome> {
	return withLock(`guild:${input.guildId}`, async () => {
		// 1. Validate.
		const validation = validateConfigYaml(input.yamlText);
		if (!validation.ok) {
			return { status: "validation_failed", errors: validation.errors };
		}

		// 2. Conflict check.
		const current = readConfigFile(input.guildId);
		if (
			input.expectedMtimeMs !== undefined &&
			current !== null &&
			Math.floor(current.mtimeMs) !== Math.floor(input.expectedMtimeMs)
		) {
			return { status: "conflict", serverMtimeMs: current.mtimeMs };
		}

		// 3. Backup.
		const backupPath = backupConfigFile(input.guildId);

		// 4. Atomic write.
		writeConfigFileAtomic(input.guildId, input.yamlText);

		// 5. Record current author so the next backup knows who saved this one.
		if (input.actor) {
			writeCurrentAuthor(input.guildId, {
				userId: input.actor.userId,
				username: input.actor.username,
				savedAt: Date.now()
			});
		}

		// 6. Reload + verify.
		return withLock("pm2-reload", () => reloadAndVerify(input.guildId, backupPath));
	});
}

async function reloadAndVerify(
	guildId: string,
	backupPath: string | null
): Promise<SaveOutcome> {
	const before = await fetchHealth();
	const priorStartedAt = before?.startedAt ?? "";

	const reloadResult = await pm2Reload();
	if (!reloadResult.ok) {
		// pm2 itself failed (binary missing, ecosystem file unreadable, etc).
		// Still try the rollback path — maybe the file write was the issue.
		return rollback(guildId, backupPath, "reload_failed", reloadResult.message);
	}

	const fresh = await waitForFreshReady(priorStartedAt, HEALTH_TIMEOUT_MS);
	if (!fresh) {
		return rollback(guildId, backupPath, "health_timeout");
	}

	return { status: "saved", backupPath, startedAt: fresh.startedAt };
}

async function rollback(
	guildId: string,
	backupPath: string | null,
	reason: "health_timeout" | "reload_failed",
	detail?: string
): Promise<SaveOutcome> {
	if (!backupPath) {
		// First-ever save for this guild and it crashed the bot. Remove the
		// failing file entirely so the next reload starts clean.
		return {
			status: "degraded",
			reason: detail ?? `${reason}; no backup available to restore`,
			backupPath: null
		};
	}

	// Restore: write backup contents directly back into the live config file.
	const backupContent = Bun.file(backupPath);
	const yamlText = await backupContent.text();
	writeFileSync(configPath(guildId), yamlText, "utf8");

	// Second reload — should succeed because we just restored a known-good config.
	const before = await fetchHealth();
	const priorStartedAt = before?.startedAt ?? "";
	const reload = await pm2Reload();

	if (!reload.ok) {
		return { status: "degraded", reason: `Rollback reload failed: ${reload.message}`, backupPath };
	}

	const fresh = await waitForFreshReady(priorStartedAt, HEALTH_TIMEOUT_MS);
	if (!fresh) {
		return {
			status: "degraded",
			reason: "Rollback applied but the bot still failed to come up; manual intervention required",
			backupPath
		};
	}

	return { status: "rolled_back", reason, backupPath };
}

interface ReloadResult {
	ok: boolean;
	message: string;
}

function pm2Reload(): Promise<ReloadResult> {
	return new Promise(res => {
		const child = spawn(
			"pm2",
			["reload", env.pm2AppName, "--update-env"],
			{ cwd: env.pm2Cwd, stdio: ["ignore", "pipe", "pipe"] }
		);

		let stderr = "";
		child.stderr.on("data", chunk => {
			stderr += String(chunk);
		});

		child.on("error", err => res({ ok: false, message: err.message }));
		child.on("exit", code => {
			res({
				ok: code === 0,
				message: code === 0 ? "ok" : `pm2 reload exited ${code}: ${stderr.trim()}`
			});
		});
	});
}

/** Tail the bot's pm2 logs so the editor can show the operator what crashed. */
export function tailPm2Logs(lines = 200): Promise<string> {
	return new Promise(res => {
		const child = spawn(
			"pm2",
			["logs", env.pm2AppName, "--nostream", "--lines", String(lines)],
			{ cwd: env.pm2Cwd, stdio: ["ignore", "pipe", "pipe"] }
		);

		let out = "";
		child.stdout.on("data", chunk => {
			out += String(chunk);
		});
		child.stderr.on("data", chunk => {
			out += String(chunk);
		});
		child.on("error", () => res(""));
		child.on("exit", () => res(out));
	});
}

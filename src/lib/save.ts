// Save pipeline: validate → backup → write → pm2 reload → poll /healthz.
// If the new config doesn't come up healthy, restore the backup and reload
// again; if THAT fails, return `degraded` for manual intervention.
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
	/** Optimistic-concurrency token: aborts if on-disk mtime differs. */
	expectedMtimeMs?: number;
	actor?: { userId: string; username: string };
}

export async function saveGuildConfig(input: SaveInput): Promise<SaveOutcome> {
	return withLock(`guild:${input.guildId}`, async () => {
		const validation = validateConfigYaml(input.yamlText);
		if (!validation.ok) {
			return { status: "validation_failed", errors: validation.errors };
		}

		const current = readConfigFile(input.guildId);
		if (
			input.expectedMtimeMs !== undefined &&
			current !== null &&
			Math.floor(current.mtimeMs) !== Math.floor(input.expectedMtimeMs)
		) {
			return { status: "conflict", serverMtimeMs: current.mtimeMs };
		}

		const backupPath = backupConfigFile(input.guildId);
		writeConfigFileAtomic(input.guildId, input.yamlText);

		if (input.actor) {
			writeCurrentAuthor(input.guildId, {
				userId: input.actor.userId,
				username: input.actor.username,
				savedAt: Date.now()
			});
		}

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
		// First-ever save crashed the bot — no backup to fall back to.
		return {
			status: "degraded",
			reason: detail ?? `${reason}; no backup available to restore`,
			backupPath: null
		};
	}

	const backupContent = Bun.file(backupPath);
	const yamlText = await backupContent.text();
	writeFileSync(configPath(guildId), yamlText, "utf8");

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

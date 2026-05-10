/**
 * Per-guild config endpoints:
 *   GET    /api/guilds/:guildId/config             → current YAML + mtime + parse
 *   POST   /api/guilds/:guildId/config/validate    → server-side safeParse
 *   POST   /api/guilds/:guildId/config             → save pipeline
 *   GET    /api/guilds/:guildId/config/backups     → list backups
 *   POST   /api/guilds/:guildId/config/restore     → restore + reload
 */
import { Hono } from "hono";
import { sessionMiddleware } from "@/middleware/session";
import { guildAuthMiddleware, type GuildAuthEnv } from "@/middleware/guildAuth";
import { listBackups, readBackup, readConfigFile, validateConfigYaml } from "@lib/config";
import { saveGuildConfig, tailPm2Logs } from "@lib/save";
import { recordAuditEvent } from "@lib/audit";
import { hashYaml, notifyConfigChange } from "@lib/webhook";

export const configRoutes = new Hono<GuildAuthEnv>()
	.use("*", sessionMiddleware, guildAuthMiddleware);

configRoutes.get("/", c => {
	const guildId = c.get("guildId");
	const file = readConfigFile(guildId);
	if (!file) {
		return c.json({ guildId, yaml: "", mtimeMs: 0, parse: null });
	}
	const validation = validateConfigYaml(file.yamlText);
	return c.json({
		guildId,
		yaml: file.yamlText,
		mtimeMs: file.mtimeMs,
		parse: validation
	});
});

configRoutes.post("/validate", async c => {
	const body = await c.req.json<{ yaml?: string }>();
	if (typeof body.yaml !== "string") {
		return c.json({ error: "missing_yaml" }, 400);
	}
	return c.json(validateConfigYaml(body.yaml));
});

configRoutes.post("/", async c => {
	const session = c.get("session")!;
	const guildId = c.get("guildId");
	const body = await c.req.json<{ yaml?: string; expectedMtimeMs?: number }>();

	if (typeof body.yaml !== "string") {
		return c.json({ error: "missing_yaml" }, 400);
	}

	const before = readConfigFile(guildId);
	const outcome = await saveGuildConfig({
		guildId,
		yamlText: body.yaml,
		expectedMtimeMs: body.expectedMtimeMs
	});

	const success = outcome.status === "saved";
	recordAuditEvent({
		userId: session.userId,
		username: session.username,
		guildId,
		action: outcome.status === "rolled_back" ? "rollback" : "save",
		beforeYaml: before?.yamlText ?? null,
		afterYaml: success ? body.yaml : null,
		success,
		errorMessage: success ? undefined : describeOutcome(outcome)
	});

	if (success) {
		// Fire-and-forget — webhook latency must not block the response.
		void notifyConfigChange({
			action: "save",
			guildId,
			username: session.username,
			beforeHash: hashYaml(before?.yamlText ?? null),
			afterHash: hashYaml(body.yaml)!
		});
	}

	if (outcome.status === "degraded") {
		const logs = await tailPm2Logs(200);
		return c.json({ ...outcome, logs }, 500);
	}
	if (outcome.status === "validation_failed") return c.json(outcome, 422);
	if (outcome.status === "conflict") return c.json(outcome, 409);
	if (outcome.status === "rolled_back") return c.json(outcome, 422);
	return c.json(outcome);
});

configRoutes.get("/backups", c => {
	const guildId = c.get("guildId");
	return c.json({ guildId, backups: listBackups(guildId).map(b => ({ stamp: b.stamp })) });
});

configRoutes.post("/restore", async c => {
	const session = c.get("session")!;
	const guildId = c.get("guildId");
	const body = await c.req.json<{ stamp?: string; expectedMtimeMs?: number }>();
	if (typeof body.stamp !== "string") {
		return c.json({ error: "missing_stamp" }, 400);
	}

	const yaml = readBackup(guildId, body.stamp);
	if (yaml === null) {
		return c.json({ error: "backup_not_found" }, 404);
	}

	const before = readConfigFile(guildId);
	const outcome = await saveGuildConfig({
		guildId,
		yamlText: yaml,
		expectedMtimeMs: body.expectedMtimeMs
	});

	recordAuditEvent({
		userId: session.userId,
		username: session.username,
		guildId,
		action: "restore",
		beforeYaml: before?.yamlText ?? null,
		afterYaml: outcome.status === "saved" ? yaml : null,
		success: outcome.status === "saved",
		errorMessage: outcome.status === "saved" ? undefined : describeOutcome(outcome)
	});

	if (outcome.status === "saved") {
		void notifyConfigChange({
			action: "restore",
			guildId,
			username: session.username,
			beforeHash: hashYaml(before?.yamlText ?? null),
			afterHash: hashYaml(yaml)!
		});
	}

	return c.json(outcome);
});

function describeOutcome(outcome: Awaited<ReturnType<typeof saveGuildConfig>>): string {
	switch (outcome.status) {
		case "validation_failed": return `validation failed: ${outcome.errors.map(e => `${e.path}: ${e.message}`).join("; ")}`;
		case "conflict": return "config changed on disk while editing";
		case "rolled_back": return `rolled back: ${outcome.reason}`;
		case "degraded": return `degraded: ${outcome.reason}`;
		default: return outcome.status;
	}
}

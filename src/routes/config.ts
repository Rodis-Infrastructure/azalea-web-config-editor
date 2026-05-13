/**
 * Per-guild config endpoints:
 *   GET    /api/guilds/:guildId/config             → current YAML + mtime + parse
 *   POST   /api/guilds/:guildId/config/validate    → server-side safeParse
 *   POST   /api/guilds/:guildId/config             → save pipeline
 *   GET    /api/guilds/:guildId/config/backups     → list backups
 *   POST   /api/guilds/:guildId/config/restore     → restore + reload
 */
import { Hono } from "hono";
import { parse as yamlParse } from "yaml";
import { sessionMiddleware } from "@/middleware/session";
import { guildAuthMiddleware, type GuildAuthEnv } from "@/middleware/guildAuth";
import { listBackups, readBackup, readConfigFile, validateConfigYaml } from "@lib/config";
import { saveGuildConfig, tailPm2Logs } from "@lib/save";
import { recordAuditEvent } from "@lib/audit";
import { hashYaml, notifyConfigChange } from "@lib/webhook";
import { env } from "@lib/env";

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
		expectedMtimeMs: body.expectedMtimeMs,
		actor: { userId: session.userId, username: session.username }
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
	return c.json({
		guildId,
		backups: listBackups(guildId).map(b => ({ stamp: b.stamp, author: b.author }))
	});
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
		expectedMtimeMs: body.expectedMtimeMs,
		actor: { userId: session.userId, username: session.username }
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

/**
 * Proxy a "test message" through the editor's preview webhook (configured
 * via `TEST_WEBHOOK_URL`). The caller pastes a YAML fragment — a single
 * embed, an array of embeds, or a raw string for `content` — and we
 * forward to Discord with mentions suppressed so nobody gets pinged from
 * a preview.
 */
configRoutes.post("/test-webhook", async c => {
	const url = env.testWebhookUrl;
	if (!url) {
		return c.json({ ok: false, error: "TEST_WEBHOOK_URL is not configured on the server." }, 503);
	}

	const body = await c.req.json<{ yaml?: string }>();
	if (typeof body.yaml !== "string" || body.yaml.trim() === "") {
		return c.json({ ok: false, error: "Paste a YAML embed (or message content) to send." }, 400);
	}

	let parsed: unknown;
	try {
		parsed = yamlParse(body.yaml);
	} catch (err) {
		return c.json({ ok: false, error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` }, 400);
	}

	const payload = buildWebhookPayload(parsed);
	if ("error" in payload) {
		return c.json({ ok: false, error: payload.error }, 400);
	}

	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload.value)
	}).catch(err => {
		throw new Error(`Webhook POST failed: ${err instanceof Error ? err.message : String(err)}`);
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		return c.json({ ok: false, error: `Discord rejected the webhook (${res.status}): ${text.slice(0, 500)}` }, 400);
	}
	return c.json({ ok: true });
});

interface DiscordWebhookPayload {
	content?: string;
	embeds?: unknown[];
	allowed_mentions: { parse: [] };
}

function buildWebhookPayload(parsed: unknown): { value: DiscordWebhookPayload } | { error: string } {
	const allowed_mentions = { parse: [] as [] };

	if (typeof parsed === "string") {
		return { value: { content: parsed, allowed_mentions } };
	}
	if (Array.isArray(parsed)) {
		if (parsed.length === 0) return { error: "YAML array is empty." };
		if (parsed.length > 10) return { error: "Discord allows at most 10 embeds per message." };
		if (!parsed.every(item => isPlainObject(item))) {
			return { error: "YAML arrays must contain embed objects." };
		}
		return { value: { embeds: parsed, allowed_mentions } };
	}
	if (isPlainObject(parsed)) {
		// If it looks like a full Discord-style payload (has top-level content
		// or embeds keys), respect that. Otherwise treat the object as a single
		// embed — matches how embeds are defined in the YAML config.
		const obj = parsed as Record<string, unknown>;
		if ("embeds" in obj || "content" in obj) {
			const out: DiscordWebhookPayload = { allowed_mentions };
			if (typeof obj.content === "string") out.content = obj.content;
			if (Array.isArray(obj.embeds)) out.embeds = obj.embeds;
			return { value: out };
		}
		return { value: { embeds: [obj], allowed_mentions } };
	}
	return { error: "YAML must parse to a string, object, or array of embed objects." };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeOutcome(outcome: Awaited<ReturnType<typeof saveGuildConfig>>): string {
	switch (outcome.status) {
		case "validation_failed": return `validation failed: ${outcome.errors.map(e => `${e.path}: ${e.message}`).join("; ")}`;
		case "conflict": return "config changed on disk while editing";
		case "rolled_back": return `rolled back: ${outcome.reason}`;
		case "degraded": return `degraded: ${outcome.reason}`;
		default: return outcome.status;
	}
}

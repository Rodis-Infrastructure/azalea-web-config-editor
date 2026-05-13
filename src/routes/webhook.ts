// Webhook builder backend:
//   POST   /api/guilds/:guildId/webhook/proxy
//   GET    /api/guilds/:guildId/webhook/saved
//   POST   /api/guilds/:guildId/webhook/saved
//   DELETE /api/guilds/:guildId/webhook/saved/:id
//
// Proxying through the editor keeps the webhook URL out of the
// browser's network panel and reuses our same Discord-URL validation.
import { Hono } from "hono";
import { sessionMiddleware } from "@/middleware/session";
import { guildAuthMiddleware, type GuildAuthEnv } from "@/middleware/guildAuth";
import { env } from "@lib/env";
import { getDb } from "@lib/db";
import { decrypt, encrypt } from "@lib/crypto";

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/;
const PROXY_TIMEOUT_MS = 8_000;

export const webhookRoutes = new Hono<GuildAuthEnv>()
	.use("*", sessionMiddleware, guildAuthMiddleware);

// ──────────────────────────────────────────────────────────────────
// Proxy
// ──────────────────────────────────────────────────────────────────

interface ProxyRequestBody {
	target?: "custom" | "test";
	webhookUrl?: string;
	messageId?: string;
	threadId?: string;
	payload?: unknown;
}

webhookRoutes.post("/proxy", async c => {
	const body = await c.req.json<ProxyRequestBody>();

	const target = body.target;
	if (target !== "custom" && target !== "test") {
		return c.json({ ok: false, error: "target must be 'custom' or 'test'" }, 400);
	}

	let baseUrl: string;
	if (target === "test") {
		if (!env.testWebhookUrl) {
			return c.json({ ok: false, error: "TEST_WEBHOOK_URL is not configured on the server." }, 503);
		}
		baseUrl = env.testWebhookUrl;
	} else {
		if (typeof body.webhookUrl !== "string" || !DISCORD_WEBHOOK_RE.test(body.webhookUrl)) {
			return c.json({ ok: false, error: "Webhook URL must look like https://discord.com/api/webhooks/…" }, 400);
		}
		baseUrl = body.webhookUrl;
	}

	if (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload)) {
		return c.json({ ok: false, error: "payload must be a JSON object" }, 400);
	}

	if (body.messageId !== undefined && !/^\d{17,21}$/.test(body.messageId)) {
		return c.json({ ok: false, error: "messageId must be a Discord snowflake" }, 400);
	}
	if (body.threadId !== undefined && !/^\d{17,21}$/.test(body.threadId)) {
		return c.json({ ok: false, error: "threadId must be a Discord snowflake" }, 400);
	}

	// Build the Discord URL — strip any caller-supplied query string and
	// route to /messages/<id> when editing.
	const url = new URL(baseUrl);
	url.search = "";
	url.pathname = url.pathname.replace(/\/+$/, "");
	const method: "POST" | "PATCH" = body.messageId ? "PATCH" : "POST";
	if (body.messageId) {
		url.pathname += `/messages/${body.messageId}`;
	} else {
		// `wait=true` makes Discord return the created Message so the
		// client can save it for later edits.
		url.searchParams.set("wait", "true");
	}
	if (body.threadId) {
		url.searchParams.set("thread_id", body.threadId);
	}

	let res: Response;
	try {
		res = await fetch(url.toString(), {
			method,
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body.payload),
			signal: AbortSignal.timeout(PROXY_TIMEOUT_MS)
		});
	} catch (err) {
		return c.json({
			ok: false,
			status: 502,
			error: err instanceof Error ? err.message : String(err)
		}, 502);
	}

	const text = await res.text();
	let discordBody: unknown = text;
	try { discordBody = JSON.parse(text); } catch { /* keep raw text */ }

	return c.json({ ok: res.ok, status: res.status, body: discordBody });
});

// ──────────────────────────────────────────────────────────────────
// Saved messages
// ──────────────────────────────────────────────────────────────────

interface SavedMessageRow {
	id: number;
	user_id: string;
	guild_id: string;
	webhook_url: string;
	message_id: string;
	thread_id: string | null;
	content_preview: string;
	name: string | null;
	saved_at: number;
}

interface SavedMessageView {
	id: number;
	name: string | null;
	webhookUrl: string;
	messageId: string;
	threadId: string | null;
	contentPreview: string;
	savedAt: number;
}

function rowToView(row: SavedMessageRow): SavedMessageView {
	let webhookUrl = "";
	try { webhookUrl = decrypt(row.webhook_url); } catch { /* leave empty */ }
	return {
		id: row.id,
		name: row.name,
		webhookUrl,
		messageId: row.message_id,
		threadId: row.thread_id,
		contentPreview: row.content_preview,
		savedAt: row.saved_at
	};
}

webhookRoutes.get("/saved", c => {
	const session = c.get("session")!;
	const guildId = c.get("guildId");
	const rows = getDb()
		.query<SavedMessageRow, [string, string]>(
			`SELECT id, user_id, guild_id, webhook_url, message_id, thread_id, content_preview, name, saved_at
			FROM saved_webhook_messages
			WHERE user_id = ? AND guild_id = ?
			ORDER BY saved_at DESC
			LIMIT 100`
		)
		.all(session.userId, guildId);
	return c.json({ messages: rows.map(rowToView) });
});

interface SaveBody {
	webhookUrl?: string;
	messageId?: string;
	threadId?: string;
	contentPreview?: string;
	name?: string;
}

webhookRoutes.post("/saved", async c => {
	const session = c.get("session")!;
	const guildId = c.get("guildId");
	const body = await c.req.json<SaveBody>();

	if (typeof body.webhookUrl !== "string" || !DISCORD_WEBHOOK_RE.test(body.webhookUrl)) {
		return c.json({ ok: false, error: "Webhook URL must look like https://discord.com/api/webhooks/…" }, 400);
	}
	if (typeof body.messageId !== "string" || !/^\d{17,21}$/.test(body.messageId)) {
		return c.json({ ok: false, error: "messageId must be a Discord snowflake" }, 400);
	}
	if (body.threadId !== undefined && body.threadId !== "" && !/^\d{17,21}$/.test(body.threadId)) {
		return c.json({ ok: false, error: "threadId must be a Discord snowflake" }, 400);
	}

	const preview = (body.contentPreview ?? "").slice(0, 200);
	const name = typeof body.name === "string" && body.name.trim() !== ""
		? body.name.trim().slice(0, 80)
		: null;

	const result = getDb().run(
		`INSERT INTO saved_webhook_messages
			(user_id, guild_id, webhook_url, message_id, thread_id, content_preview, name, saved_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			session.userId,
			guildId,
			encrypt(body.webhookUrl),
			body.messageId,
			body.threadId && body.threadId !== "" ? body.threadId : null,
			preview,
			name,
			Date.now()
		]
	);

	return c.json({ ok: true, id: Number(result.lastInsertRowid) });
});

webhookRoutes.delete("/saved/:id", c => {
	const session = c.get("session")!;
	const guildId = c.get("guildId");
	const idParam = Number.parseInt(c.req.param("id"), 10);
	if (!Number.isFinite(idParam)) {
		return c.json({ ok: false, error: "invalid id" }, 400);
	}

	const result = getDb().run(
		`DELETE FROM saved_webhook_messages
			WHERE id = ? AND user_id = ? AND guild_id = ?`,
		[idParam, session.userId, guildId]
	);
	if (result.changes === 0) {
		return c.json({ ok: false, error: "not_found" }, 404);
	}
	return c.json({ ok: true });
});

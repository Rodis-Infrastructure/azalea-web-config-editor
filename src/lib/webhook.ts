/**
 * Optional Discord-webhook notifier for config changes.
 *
 * `notifyConfigChange` is called from the save / restore route after a
 * successful save outcome. When `CHANGE_WEBHOOK_URL` isn't set the call
 * is a fast no-op; otherwise it posts a single embed describing the
 * actor, guild, and before/after content hashes.
 *
 * The function deliberately takes hash *prefixes* — never the raw YAML.
 * Configs can run to thousands of lines and Discord embeds cap fields at
 * 1024 chars anyway; hashes are enough to confirm "something changed"
 * and to correlate with the editor's audit log, which keeps the full
 * before/after blobs locally for forensics.
 *
 * Fire-and-forget — callers should `void`-prefix the call so webhook
 * latency or failure never blocks the user's HTTP response.
 */
import { createHash } from "node:crypto";
import { env } from "@lib/env";
import { fetchGuild } from "@lib/discord";

const WEBHOOK_TIMEOUT_MS = 5_000;

const COLOR_SAVED = 0x36c98c;
const COLOR_RESTORED = 0xf0a020;

export interface ChangeNotification {
	action: "save" | "restore";
	guildId: string;
	username: string;
	/** Short SHA-256 prefix of the previous YAML, or null for a brand-new file. */
	beforeHash: string | null;
	/** Short SHA-256 prefix of the YAML that was just written. */
	afterHash: string;
}

/** SHA-256 prefix matching what {@link notifyConfigChange} expects. */
export function hashYaml(yaml: string | null): string | null {
	if (yaml === null) return null;
	return createHash("sha256").update(yaml).digest("hex").slice(0, 12);
}

export async function notifyConfigChange(input: ChangeNotification): Promise<void> {
	const url = env.changeWebhookUrl;
	if (!url) return;

	const guildLabel = await fetchGuild(input.guildId)
		.then(g => `${g.name} (\`${input.guildId}\`)`)
		.catch(() => `\`${input.guildId}\``);

	const isRestore = input.action === "restore";
	// Username goes into a structured field rather than the description
	// sentence: an operator's Discord handle can contain backticks,
	// asterisks, and other markdown-meaningful characters, and embed
	// descriptions render them. Field values still render markdown, but
	// the bounded layout means a stray backtick can't bleed into
	// surrounding text.
	const payload = {
		embeds: [{
			title: isRestore ? "🔄 Config restored" : "✅ Config saved",
			color: isRestore ? COLOR_RESTORED : COLOR_SAVED,
			description: `${isRestore ? "Restored" : "Saved"} ${guildLabel}.`,
			fields: [
				{ name: "Actor", value: input.username, inline: true },
				{ name: "Before", value: `\`${input.beforeHash ?? "(none)"}\``, inline: true },
				{ name: "After", value: `\`${input.afterHash}\``, inline: true }
			],
			timestamp: new Date().toISOString()
		}]
	};

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			console.warn(`change webhook failed: ${res.status} ${body}`);
		}
	} catch (err) {
		console.warn("change webhook error:", err instanceof Error ? err.message : err);
	}
}

// Posts content-hash embeds (never raw YAML) to CHANGE_WEBHOOK_URL.
// Fire-and-forget: callers `void`-prefix so webhook latency doesn't
// block the user's response.
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
	beforeHash: string | null;
	afterHash: string;
}

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
	// Username goes into a field, not the description: Discord handles
	// can contain backticks/asterisks that would otherwise break the
	// embed's markdown.
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

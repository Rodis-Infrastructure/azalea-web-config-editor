/**
 * Environment access. `env` returns whatever is configured (or sensible
 * defaults) without throwing — modules that only need a path or a default
 * value can read it freely. The server entry calls `assertRuntimeEnv()`
 * before binding a port to verify every required field is set.
 */
import { resolve } from "node:path";

function readPath(name: string): string {
	const value = process.env[name] ?? "";
	return value ? resolve(value) : "";
}

function readString(name: string, fallback = ""): string {
	return process.env[name] ?? fallback;
}

function readNumber(name: string, fallback: number): number {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) ? value : fallback;
}

const repoPath = readPath("AZALEA_REPO_PATH");

const redirectUri = readString("DISCORD_OAUTH_REDIRECT_URI");

export const env = {
	repoPath,
	configsDir: repoPath ? resolve(repoPath, "configs") : "",
	backupsDir: repoPath ? resolve(repoPath, "configs", ".backups") : "",
	pm2AppName: readString("AZALEA_PM2_APP_NAME", "azalea"),
	pm2Cwd: repoPath ? resolve(repoPath, "..") : "",
	healthUrl: readString("AZALEA_HEALTH_URL", "http://127.0.0.1:7475/healthz"),
	discord: {
		clientId: readString("DISCORD_CLIENT_ID"),
		clientSecret: readString("DISCORD_CLIENT_SECRET"),
		redirectUri,
		botToken: readString("DISCORD_TOKEN")
	},
	sessionSecret: readString("SESSION_SECRET"),
	editorHost: readString("EDITOR_HOST", "127.0.0.1"),
	editorPort: readNumber("EDITOR_PORT", 7476),
	/**
	 * Port Hono actually binds to. In dev this is set to a different port
	 * (e.g. 7477) so Vite can serve the UI on EDITOR_PORT and proxy here.
	 * In prod it falls through to EDITOR_PORT and Hono serves both API
	 * and the built UI on the user-facing port.
	 */
	backendPort: readNumber("BACKEND_PORT", readNumber("EDITOR_PORT", 7476)),
	bootstrapUserIds: new Set(
		readString("BOOTSTRAP_USER_IDS", "")
			.split(",")
			.map(id => id.trim())
			.filter(Boolean)
	),
	/**
	 * Optional Discord webhook URL. When set, every successful save or
	 * restore posts an embed describing who changed what. When unset,
	 * the post is silently skipped — the feature is fully opt-in.
	 */
	changeWebhookUrl: readString("CHANGE_WEBHOOK_URL"),
	// Derive cookie security from the OAuth redirect URI: HTTPS deploys get
	// `Secure` on every cookie, plain-HTTP local dev does not (otherwise the
	// browser refuses to send cookies back over the unencrypted callback).
	cookieSecure: redirectUri.startsWith("https://")
} as const;

const REQUIRED: { name: string; value: string }[] = [
	{ name: "AZALEA_REPO_PATH", value: env.repoPath },
	{ name: "DISCORD_CLIENT_ID", value: env.discord.clientId },
	{ name: "DISCORD_CLIENT_SECRET", value: env.discord.clientSecret },
	{ name: "DISCORD_OAUTH_REDIRECT_URI", value: env.discord.redirectUri },
	{ name: "DISCORD_TOKEN", value: env.discord.botToken },
	{ name: "SESSION_SECRET", value: env.sessionSecret }
];

/**
 * Throws if any required env var is missing. Called once from the server
 * entry; never from library code or tests.
 */
export function assertRuntimeEnv(): void {
	const missing = REQUIRED.filter(({ value }) => !value).map(({ name }) => name);
	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}
}

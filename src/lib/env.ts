// `env` returns whatever's set (or a default) without throwing.
// `assertRuntimeEnv()` is called once at boot to fail fast on missing
// required vars.
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
	// Dev sets BACKEND_PORT separately so Vite owns EDITOR_PORT and proxies.
	// In prod Hono binds to EDITOR_PORT directly.
	backendPort: readNumber("BACKEND_PORT", readNumber("EDITOR_PORT", 7476)),
	bootstrapUserIds: new Set(
		readString("BOOTSTRAP_USER_IDS", "")
			.split(",")
			.map(id => id.trim())
			.filter(Boolean)
	),
	changeWebhookUrl: readString("CHANGE_WEBHOOK_URL"),
	testWebhookUrl: readString("TEST_WEBHOOK_URL"),
	auditBlobRetentionDays: readNumber("AUDIT_BLOB_RETENTION_DAYS", 90),
	// HTTPS deploys get Secure cookies; plain-HTTP dev does not, else
	// the browser drops the cookie on the callback.
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

export function assertRuntimeEnv(): void {
	const missing = REQUIRED.filter(({ value }) => !value).map(({ name }) => name);
	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}
}

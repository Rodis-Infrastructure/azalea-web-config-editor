/**
 * Thin fetch wrapper for the editor's JSON API. All routes are same-origin
 * (Vite dev proxies /api, /auth, /healthz to Hono in dev; in prod Hono
 * serves both API and static).
 */

/**
 * `body` is always typed as the caller's `T` even on error responses —
 * every editor endpoint returns structured JSON with at least an `error`
 * or `status` field, so callers narrow on body shape rather than on `ok`.
 */
export interface ApiResponse<T> {
	ok: boolean;
	status: number;
	body: T;
}

export async function api<T = unknown>(
	path: string,
	init?: RequestInit
): Promise<ApiResponse<T>> {
	const headers: Record<string, string> = {
		...(init?.headers as Record<string, string> | undefined)
	};
	if (init?.body && !headers["content-type"]) {
		headers["content-type"] = "application/json";
	}

	const res = await fetch(path, {
		credentials: "same-origin",
		...init,
		headers
	});

	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json")
		? await res.json()
		: await res.text();

	return { ok: res.ok, status: res.status, body: body as T };
}

export interface Me {
	userId: string;
	username: string;
	manageableGuilds: { id: string; name: string; icon: string | null; via: "bootstrap" | "permission" }[];
	testWebhookConfigured: boolean;
}

export interface ConfigPayload {
	guildId: string;
	yaml: string;
	mtimeMs: number;
	parse: ValidationResult | null;
}

export type ValidationResult =
	| { ok: true; parsed: unknown }
	| { ok: false; stage: "yaml" | "schema"; errors: { path: string; message: string }[] };

export interface SaveOutcome {
	status: "saved" | "validation_failed" | "conflict" | "rolled_back" | "degraded";
	startedAt?: string;
	backupPath?: string | null;
	errors?: { path: string; message: string }[];
	reason?: string;
	serverMtimeMs?: number;
}

export interface AuditEvent {
	id: number;
	ts: number;
	userId: string;
	username: string;
	guildId: string;
	action: string;
	beforeHash: string | null;
	afterHash: string | null;
	success: boolean;
	errorMessage: string | null;
}

export interface DiscordChannel {
	id: string;
	name: string;
	type: number;
	parent_id: string | null;
	position: number;
}

export interface DiscordRole {
	id: string;
	name: string;
	color: number;
	position: number;
	managed: boolean;
}

export interface BackupSummary {
	stamp: string;
	author: { userId: string; username: string; savedAt: number } | null;
}

export interface HealthSnapshot {
	ok: boolean;
	ready?: boolean;
	pid?: number;
	startedAt?: string;
	name?: string;
	version?: string;
	reason?: string;
}

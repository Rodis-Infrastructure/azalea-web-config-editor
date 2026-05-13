// `body` is typed as `T` even on error responses — every endpoint
// returns structured JSON; callers narrow on body shape.
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

	// Never throw — a fetch rejection or unparseable body must become an
	// `ok: false` response, else callers that only check `res.ok` end up
	// stuck on whatever loading state they set before the call.
	try {
		const res = await fetch(path, {
			credentials: "same-origin",
			...init,
			headers
		});

		const contentType = res.headers.get("content-type") ?? "";
		const body = contentType.includes("application/json")
			? await res.json().catch(() => ({ error: "invalid_json" }))
			: await res.text().catch(() => "");

		return { ok: res.ok, status: res.status, body: body as T };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			status: 0,
			body: { error: "network_error", message } as T
		};
	}
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

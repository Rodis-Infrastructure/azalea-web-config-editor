// Append-only audit log. Stores full before/after YAML blobs for
// forensics until they age out via purgeOldAuditBlobs.
import { createHash } from "node:crypto";
import { getDb } from "@lib/db";

export type AuditAction = "view" | "validate" | "save" | "restore" | "rollback";

export interface AuditInput {
	userId: string;
	username: string;
	guildId: string;
	action: AuditAction;
	beforeYaml?: string | null;
	afterYaml?: string | null;
	success: boolean;
	errorMessage?: string;
}

export interface AuditRow {
	id: number;
	ts: number;
	userId: string;
	username: string;
	guildId: string;
	action: AuditAction;
	beforeHash: string | null;
	afterHash: string | null;
	success: boolean;
	errorMessage: string | null;
}

export function recordAuditEvent(input: AuditInput): void {
	const db = getDb();
	const beforeBlob = input.beforeYaml ?? null;
	const afterBlob = input.afterYaml ?? null;
	db.run(
		`INSERT INTO audit_events
			(ts, user_id, username, guild_id, action, before_hash, after_hash, before_blob, after_blob, success, error_message)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			Date.now(),
			input.userId,
			input.username,
			input.guildId,
			input.action,
			beforeBlob ? sha256(beforeBlob) : null,
			afterBlob ? sha256(afterBlob) : null,
			beforeBlob,
			afterBlob,
			input.success ? 1 : 0,
			input.errorMessage ?? null
		]
	);
}

export function listAuditEvents(guildId: string, limit = 100): AuditRow[] {
	const db = getDb();
	type Row = {
		id: number;
		ts: number;
		user_id: string;
		username: string;
		guild_id: string;
		action: AuditAction;
		before_hash: string | null;
		after_hash: string | null;
		success: number;
		error_message: string | null;
	};
	const rows = db
		.query<Row, [string, number]>(
			`SELECT id, ts, user_id, username, guild_id, action,
				before_hash, after_hash, success, error_message
			FROM audit_events
			WHERE guild_id = ?
			ORDER BY ts DESC, id DESC
			LIMIT ?`
		)
		.all(guildId, limit);

	return rows.map(row => ({
		id: row.id,
		ts: row.ts,
		userId: row.user_id,
		username: row.username,
		guildId: row.guild_id,
		action: row.action,
		beforeHash: row.before_hash,
		afterHash: row.after_hash,
		success: row.success === 1,
		errorMessage: row.error_message
	}));
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

// Nulls before_blob / after_blob on rows older than `retentionDays`.
// Row itself (ts, actor, action, hashes) is retained. `<= 0` disables.
export function purgeOldAuditBlobs(retentionDays: number): number {
	if (retentionDays <= 0) return 0;
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	const db = getDb();
	const result = db.run(
		`UPDATE audit_events
			SET before_blob = NULL,
				after_blob  = NULL
			WHERE ts < ?
				AND (before_blob IS NOT NULL OR after_blob IS NOT NULL)`,
		[cutoff]
	);
	return result.changes;
}

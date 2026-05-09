/**
 * Server-side session store. Sessions are persisted in SQLite so a
 * deploy / restart doesn't sign every operator out. The cookie body
 * carries only the opaque session ID + an HMAC signature.
 *
 * Permission decisions are NEVER cached in the session — they're
 * re-derived per request from the live config and member roles, so a
 * role change takes effect on the next click.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@lib/db";
import { env } from "@lib/env";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "azalea_editor_session";

export interface Session {
	id: string;
	userId: string;
	username: string;
	expiresAt: number;
}

export function createSession(userId: string, username: string): Session {
	const id = randomBytes(32).toString("hex");
	const now = Date.now();
	const expiresAt = now + SESSION_TTL_MS;

	getDb().run(
		`INSERT INTO sessions (id, user_id, username, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		[id, userId, username, expiresAt, now]
	);

	return { id, userId, username, expiresAt };
}

export function loadSession(id: string): Session | null {
	const db = getDb();
	type Row = { id: string; user_id: string; username: string; expires_at: number };
	const row = db
		.query<Row, [string, number]>(
			"SELECT id, user_id, username, expires_at FROM sessions WHERE id = ? AND expires_at > ?"
		)
		.get(id, Date.now());

	if (!row) return null;

	return {
		id: row.id,
		userId: row.user_id,
		username: row.username,
		expiresAt: row.expires_at
	};
}

export function destroySession(id: string): void {
	getDb().run("DELETE FROM sessions WHERE id = ?", [id]);
}

export function purgeExpiredSessions(): void {
	getDb().run("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
}

// Cookie signing — HMAC-SHA256 with `SESSION_SECRET`, base64url. Format:
// `<sessionId>.<signature>`. We only verify integrity here; lookup goes
// through `loadSession` which does its own expiry check.

export function signCookieValue(sessionId: string): string {
	const sig = createHmac("sha256", env.sessionSecret).update(sessionId).digest("base64url");
	return `${sessionId}.${sig}`;
}

export function verifyCookieValue(cookieValue: string): string | null {
	const dot = cookieValue.lastIndexOf(".");
	if (dot < 0) return null;

	const sessionId = cookieValue.slice(0, dot);
	const providedSig = cookieValue.slice(dot + 1);
	const expectedSig = createHmac("sha256", env.sessionSecret).update(sessionId).digest("base64url");

	const provided = Buffer.from(providedSig, "base64url");
	const expected = Buffer.from(expectedSig, "base64url");
	if (provided.length !== expected.length) return null;
	if (!timingSafeEqual(provided, expected)) return null;

	return sessionId;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

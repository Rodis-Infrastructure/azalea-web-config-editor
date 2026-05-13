// Editor-local SQLite for sessions and the audit log. Intentionally
// separate from the bot's Prisma DB.
import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const DB_PATH = resolve(import.meta.dir, "..", "..", "data", "editor.db");

let _db: Database | null = null;

export function getDb(): Database {
	if (_db) return _db;

	mkdirSync(dirname(DB_PATH), { recursive: true });
	const db = new Database(DB_PATH);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");

	migrate(db);

	_db = db;
	return db;
}

function migrate(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

		CREATE TABLE IF NOT EXISTS audit_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ts INTEGER NOT NULL,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			guild_id TEXT NOT NULL,
			action TEXT NOT NULL,
			before_hash TEXT,
			after_hash TEXT,
			before_blob TEXT,
			after_blob TEXT,
			success INTEGER NOT NULL,
			error_message TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_audit_guild_ts ON audit_events(guild_id, ts DESC);
	`);
}

export function _setDbForTesting(db: Database | null): void {
	_db = db;
	if (db) migrate(db);
}

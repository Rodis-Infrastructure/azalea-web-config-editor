import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { _setDbForTesting, getDb } from "@lib/db";
import { listAuditEvents, purgeOldAuditBlobs, recordAuditEvent } from "@lib/audit";

describe("audit log", () => {
	beforeAll(() => {
		_setDbForTesting(new Database(":memory:"));
	});

	afterAll(() => {
		_setDbForTesting(null);
	});

	test("records and reads back events for a guild", () => {
		recordAuditEvent({
			userId: "111",
			username: "alice",
			guildId: "G1",
			action: "save",
			beforeYaml: "old",
			afterYaml: "new",
			success: true
		});
		recordAuditEvent({
			userId: "222",
			username: "bob",
			guildId: "G1",
			action: "validate",
			afterYaml: "draft",
			success: false,
			errorMessage: "schema error"
		});

		const events = listAuditEvents("G1");
		expect(events).toHaveLength(2);
		// Newest first.
		expect(events[0]?.action).toBe("validate");
		expect(events[0]?.success).toBe(false);
		expect(events[0]?.errorMessage).toBe("schema error");
		expect(events[1]?.action).toBe("save");
	});

	test("filters by guildId", () => {
		recordAuditEvent({
			userId: "333",
			username: "carol",
			guildId: "G2",
			action: "view",
			success: true
		});

		const g1 = listAuditEvents("G1");
		const g2 = listAuditEvents("G2");
		expect(g1.every(r => r.guildId === "G1")).toBe(true);
		expect(g2.every(r => r.guildId === "G2")).toBe(true);
	});

	test("hashes before/after blobs", () => {
		recordAuditEvent({
			userId: "444",
			username: "dan",
			guildId: "G3",
			action: "save",
			beforeYaml: "abc",
			afterYaml: "abc",
			success: true
		});

		const events = listAuditEvents("G3");
		// Same input → same hash; both populated.
		expect(events[0]?.beforeHash).toBe(events[0]?.afterHash);
		expect(events[0]?.beforeHash).toMatch(/^[a-f0-9]{64}$/);
	});

	test("purgeOldAuditBlobs nulls blobs past the retention window but keeps the row", () => {
		const db = getDb();
		// Backdate one row by manipulating ts directly; recordAuditEvent
		// always stamps Date.now().
		recordAuditEvent({
			userId: "555",
			username: "eve",
			guildId: "G4",
			action: "save",
			beforeYaml: "ancient before",
			afterYaml: "ancient after",
			success: true
		});
		const ancientTs = Date.now() - 100 * 24 * 60 * 60 * 1000;
		db.run("UPDATE audit_events SET ts = ? WHERE guild_id = 'G4'", [ancientTs]);

		recordAuditEvent({
			userId: "666",
			username: "frank",
			guildId: "G4",
			action: "save",
			beforeYaml: "recent",
			afterYaml: "recent",
			success: true
		});

		const changes = purgeOldAuditBlobs(90);
		expect(changes).toBe(1);

		// Row count unchanged — only blob columns are nulled.
		type Row = { id: number; before_blob: string | null; after_blob: string | null };
		const rows = db
			.query<Row, [string]>("SELECT id, before_blob, after_blob FROM audit_events WHERE guild_id = ? ORDER BY ts ASC")
			.all("G4");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.before_blob).toBeNull();
		expect(rows[0]?.after_blob).toBeNull();
		expect(rows[1]?.before_blob).toBe("recent");
		expect(rows[1]?.after_blob).toBe("recent");
	});

	test("purgeOldAuditBlobs is a no-op when retention <= 0", () => {
		recordAuditEvent({
			userId: "777",
			username: "grace",
			guildId: "G5",
			action: "save",
			beforeYaml: "x",
			afterYaml: "y",
			success: true
		});

		expect(purgeOldAuditBlobs(0)).toBe(0);
		expect(purgeOldAuditBlobs(-7)).toBe(0);
	});
});

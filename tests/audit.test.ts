import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { _setDbForTesting } from "@lib/db";
import { listAuditEvents, recordAuditEvent } from "@lib/audit";

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
});

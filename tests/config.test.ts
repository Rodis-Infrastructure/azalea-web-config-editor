import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBackup, validateConfigYaml } from "@lib/config";

describe("validateConfigYaml", () => {
	test("accepts an explicit empty object (every field is optional)", () => {
		const result = validateConfigYaml("{}\n");
		expect(result.ok).toBe(true);
	});

	test("flags malformed YAML at the yaml stage", () => {
		const result = validateConfigYaml("default_purge_amount: 100\n  bad_indent: x");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.stage).toBe("yaml");
		}
	});

	test("flags schema violations with a JSON-pointer-ish path", () => {
		const result = validateConfigYaml("default_purge_amount: 9999\n");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.stage).toBe("schema");
			expect(result.errors[0]?.path).toBe("default_purge_amount");
		}
	});

	test("returns the parsed object on success", () => {
		const result = validateConfigYaml("default_purge_amount: 42\n");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.parsed).toMatchObject({ default_purge_amount: 42 });
		}
	});
});

describe("readBackup", () => {
	const GUILD_A = "100000000000000001";
	const GUILD_B = "100000000000000002";
	const STAMP = "2026-05-13T12-34-56-789Z";

	// Build a fake backups tree and point env at it so we can run the
	// path-traversal regression without touching the real repo path.
	const root = mkdtempSync(join(tmpdir(), "azalea-editor-backups-"));
	const backupsDir = join(root, ".backups");
	mkdirSync(join(backupsDir, GUILD_A), { recursive: true });
	mkdirSync(join(backupsDir, GUILD_B), { recursive: true });
	writeFileSync(join(backupsDir, GUILD_A, `${STAMP}.yml`), "from: A\n");
	writeFileSync(join(backupsDir, GUILD_B, `${STAMP}.yml`), "from: B\n");
	process.env.AZALEA_REPO_PATH = root;
	// The env module reads AZALEA_REPO_PATH once at import. Override the
	// resolved property so this test still sees the temp directory.
	const envModule = require("@lib/env") as { env: { backupsDir: string } };
	envModule.env.backupsDir = backupsDir;

	test("reads a legitimate backup", () => {
		expect(readBackup(GUILD_A, STAMP)).toBe("from: A\n");
	});

	test("rejects a stamp that escapes the guild directory", () => {
		expect(readBackup(GUILD_A, `../${GUILD_B}/${STAMP}`)).toBeNull();
	});

	test("rejects a stamp with malformed shape", () => {
		expect(readBackup(GUILD_A, "not-a-stamp")).toBeNull();
		expect(readBackup(GUILD_A, "")).toBeNull();
	});
});

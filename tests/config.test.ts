import { describe, expect, test } from "bun:test";
import { validateConfigYaml } from "@lib/config";

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

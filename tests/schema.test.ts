import { describe, expect, test } from "bun:test";
import { Permission, rawGuildConfigSchema } from "@/schema";

describe("schema re-export from bot", () => {
	test("ManageGuildConfig is exposed on the Permission enum", () => {
		const value: string = Permission.ManageGuildConfig;
		expect(value).toBe("manage_guild_config");
	});

	test("rawGuildConfigSchema accepts an empty object (every field is optional)", () => {
		const result = rawGuildConfigSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	test("rejects unknown permission strings", () => {
		const result = rawGuildConfigSchema.safeParse({
			permissions: [{ roles: ["111111111111111111"], allow: ["bogus_permission"] }]
		});
		expect(result.success).toBe(false);
	});

	test("accepts ManageGuildConfig in a permission allowlist", () => {
		const result = rawGuildConfigSchema.safeParse({
			permissions: [{ roles: ["111111111111111111"], allow: [Permission.ManageGuildConfig] }]
		});
		expect(result.success).toBe(true);
	});
});

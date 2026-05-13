import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { _resetKeyForTesting, decrypt, encrypt } from "@lib/crypto";

describe("encrypt / decrypt", () => {
	const previousSecret = process.env.SESSION_SECRET;

	beforeAll(() => {
		process.env.SESSION_SECRET = "test-secret-".padEnd(64, "0");
		// The env module captures SESSION_SECRET at import time. Patch the
		// captured value rather than re-importing.
		const envModule = require("@lib/env") as { env: { sessionSecret: string } };
		envModule.env.sessionSecret = process.env.SESSION_SECRET;
		_resetKeyForTesting();
	});

	afterAll(() => {
		if (previousSecret !== undefined) process.env.SESSION_SECRET = previousSecret;
		else delete process.env.SESSION_SECRET;
	});

	test("round-trips arbitrary input", () => {
		const inputs = [
			"https://discord.com/api/webhooks/123/abc",
			"",
			"unicode: ✉  ⌘ 🔒",
			"a".repeat(2048)
		];
		for (const input of inputs) {
			const ct = encrypt(input);
			expect(typeof ct).toBe("string");
			expect(ct).not.toBe(input);
			expect(decrypt(ct)).toBe(input);
		}
	});

	test("each encrypt produces a fresh nonce → different ciphertexts", () => {
		const plaintext = "https://discord.com/api/webhooks/123/abc";
		expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
	});

	test("tampered ciphertext fails the auth tag", () => {
		const ct = encrypt("secret");
		const tampered = Buffer.from(ct, "base64");
		const last = tampered.length - 1;
		tampered.writeUInt8(tampered.readUInt8(last) ^ 0x01, last);
		expect(() => decrypt(tampered.toString("base64"))).toThrow();
	});

	test("ciphertext shorter than nonce+tag is rejected", () => {
		expect(() => decrypt("AAAA")).toThrow();
	});
});

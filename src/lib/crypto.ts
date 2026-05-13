// AES-256-GCM helpers for storing webhook URLs at rest. The key is
// derived from SESSION_SECRET via HKDF so we don't need a separate
// secret — losing SESSION_SECRET already invalidates every session, and
// rotating it invalidates stored ciphertexts (the next save re-encrypts).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@lib/env";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
	if (cachedKey) return cachedKey;
	if (!env.sessionSecret) {
		throw new Error("encrypt(): SESSION_SECRET is required");
	}
	cachedKey = Buffer.from(
		hkdfSync("sha256", env.sessionSecret, Buffer.alloc(0), "azalea-editor:webhook-url:v1", KEY_LEN)
	);
	return cachedKey;
}

export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALGO, key(), iv);
	const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decrypt(ciphertext: string): string {
	const buf = Buffer.from(ciphertext, "base64");
	if (buf.length < IV_LEN + TAG_LEN) {
		throw new Error("decrypt(): ciphertext too short");
	}
	const iv = buf.subarray(0, IV_LEN);
	const tag = buf.subarray(buf.length - TAG_LEN);
	const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
	const decipher = createDecipheriv(ALGO, key(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function _resetKeyForTesting(): void {
	cachedKey = null;
}

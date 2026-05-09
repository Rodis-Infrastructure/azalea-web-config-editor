import { describe, expect, test } from "bun:test";
import { withLock } from "@lib/lock";

describe("withLock", () => {
	test("serialises concurrent calls with the same key", async () => {
		const events: string[] = [];

		const a = withLock("key", async () => {
			events.push("a:start");
			await new Promise(r => setTimeout(r, 10));
			events.push("a:end");
		});
		const b = withLock("key", async () => {
			events.push("b:start");
			await new Promise(r => setTimeout(r, 5));
			events.push("b:end");
		});

		await Promise.all([a, b]);

		// b cannot start until a ends.
		expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
	});

	test("different keys run in parallel", async () => {
		const order: string[] = [];

		const slow = withLock("slow", async () => {
			await new Promise(r => setTimeout(r, 30));
			order.push("slow");
		});
		const fast = withLock("fast", async () => {
			order.push("fast");
		});

		await Promise.all([slow, fast]);

		expect(order).toEqual(["fast", "slow"]);
	});

	test("releases the lock when the inner function throws", async () => {
		await withLock("err", async () => {
			throw new Error("boom");
		}).catch(() => undefined);

		// If the lock wasn't released, this would hang.
		const ran = await withLock("err", async () => "ok");
		expect(ran).toBe("ok");
	});

	test("returns the inner function's value", async () => {
		const result = await withLock("ret", async () => 42);
		expect(result).toBe(42);
	});
});

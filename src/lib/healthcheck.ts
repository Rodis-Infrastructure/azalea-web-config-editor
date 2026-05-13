/**
 * Poll the bot's `/healthz` endpoint to verify a `pm2 reload` produced a
 * fresh, healthy process.
 *
 * The signal we care about is `startedAt`: the editor captures it before
 * the reload, polls afterwards, and waits for a strictly greater value
 * with `ready: true`. PM2's own `restart_time` and `online` status both
 * lie about reload outcomes (incremented / set before ClientReady fires),
 * so reading the bot's own readiness is the only reliable signal.
 */
import { env } from "@lib/env";

export interface HealthSnapshot {
	ready: boolean;
	pid: number;
	startedAt: string;
	name: string;
	version: string;
}

const POLL_INTERVAL_MS = 500;
const HEALTH_FETCH_TIMEOUT_MS = 5_000;

/** Fetches the current health snapshot. Returns null on any failure. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthSnapshot | null> {
	try {
		const res = await fetch(env.healthUrl, {
			signal: signal ?? AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		return await res.json() as HealthSnapshot;
	} catch {
		return null;
	}
}

/**
 * Wait until `/healthz` reports `ready: true` from a process started after
 * `priorStartedAt`. Returns the new snapshot, or null on timeout.
 */
export async function waitForFreshReady(
	priorStartedAt: string,
	timeoutMs: number
): Promise<HealthSnapshot | null> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const snapshot = await fetchHealth();

		if (snapshot && snapshot.ready && snapshot.startedAt > priorStartedAt) {
			return snapshot;
		}

		await sleep(POLL_INTERVAL_MS);
	}

	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

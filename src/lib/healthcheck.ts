// Watch `startedAt` from the bot's /healthz, not pm2's restart_time —
// pm2 reports `online` before ClientReady actually fires.
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

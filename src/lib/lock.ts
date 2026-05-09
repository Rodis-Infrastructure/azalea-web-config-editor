/**
 * Per-key in-memory mutex. The plan's architecture pins the editor to a
 * single PM2 instance, so cross-process locking would be over-engineering;
 * the same JS process serialises every save.
 *
 * Used for two things:
 * - Per-guild key (e.g. "guild:1234"): prevents two operators editing the
 *   same guild from clobbering each other mid-write.
 * - The global "pm2-reload" key: ensures only one `pm2 reload` runs at a
 *   time, regardless of which guild triggered it.
 */
const queues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` while holding the lock for `key`. Concurrent callers with the
 * same key are serialised in arrival order; different keys run in parallel.
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = queues.get(key) ?? Promise.resolve();
	const next = previous
		.catch(() => undefined) // Don't propagate predecessor errors to the queue
		.then(fn);
	queues.set(key, next);

	// Once this run completes (success or failure), evict the queue head if
	// nothing else has chained behind us in the meantime. Without this the
	// map grows unbounded.
	void next.catch(() => undefined).then(() => {
		if (queues.get(key) === next) queues.delete(key);
	});

	return next;
}

// In-memory mutex. Editor is single-process so cross-process locking
// would be overkill. Keys in use: `guild:<id>` and `pm2-reload`.
const queues = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = queues.get(key) ?? Promise.resolve();
	const next = previous
		.catch(() => undefined) // Predecessor errors don't poison the queue.
		.then(fn);
	queues.set(key, next);

	// Evict the head when no one chained behind us, else the map leaks.
	void next.catch(() => undefined).then(() => {
		if (queues.get(key) === next) queues.delete(key);
	});

	return next;
}

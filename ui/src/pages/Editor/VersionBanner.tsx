import { useEffect, useRef, useState } from "react";
import { api, type HealthSnapshot } from "../../lib/api";

const POLL_MS = 60_000;

export function VersionBanner(): JSX.Element | null {
	const [message, setMessage] = useState<string | null>(null);
	const pinned = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const poll = async (): Promise<void> => {
			const res = await api<HealthSnapshot>("/api/health");
			if (cancelled) return;
			if (!res.ok || !res.body.ok) {
				setMessage("Bot is unreachable on /healthz — saves will fail until it's running.");
				return;
			}
			const v = res.body.version;
			if (!v) return;
			if (pinned.current === null) {
				pinned.current = v;
				return;
			}
			if (v !== pinned.current) {
				setMessage(`Bot was redeployed (${pinned.current} → ${v}). The schema may have changed; reload before saving.`);
			} else {
				setMessage(null);
			}
		};
		void poll();
		const handle = setInterval(poll, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(handle);
		};
	}, []);

	if (!message) return null;
	return (
		<div className="mb-3 px-3 py-2 rounded bg-[#3a2a10] text-warn text-sm">{message}</div>
	);
}

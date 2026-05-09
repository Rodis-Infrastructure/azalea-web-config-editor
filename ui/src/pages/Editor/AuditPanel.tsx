import type { AuditEvent } from "../../lib/api";
import { fmtTimestamp } from "../../lib/format";

export function AuditPanel({ events }: { events: AuditEvent[] }): JSX.Element {
	if (events.length === 0) {
		return <div className="text-xs text-muted py-1.5">No activity yet.</div>;
	}
	return (
		<ul className="text-xs max-h-[240px] overflow-y-auto">
			{events.map(e => (
				<li
					key={e.id}
					className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-b-0"
				>
					<div>
						<span className="text-fg">{e.username}</span>
						<span className="text-muted ml-1">
							· {e.action}
							{!e.success && " ✗"}
						</span>
					</div>
					<time className="text-muted text-[11px]">{fmtTimestamp(e.ts)}</time>
				</li>
			))}
		</ul>
	);
}

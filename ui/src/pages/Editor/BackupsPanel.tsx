import type { BackupSummary } from "../../lib/api";
import { fmtBackupStamp } from "../../lib/format";

interface Props {
	backups: BackupSummary[];
	onRestore: (stamp: string) => void;
}

export function BackupsPanel({ backups, onRestore }: Props): JSX.Element {
	if (backups.length === 0) {
		return <div className="text-xs text-muted py-1.5">No backups yet.</div>;
	}
	return (
		<ul className="text-xs max-h-[240px] overflow-y-auto">
			{backups.map(b => (
				<li
					key={b.stamp}
					className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-b-0"
				>
					<div className="flex-1 min-w-0">
						<time className="text-fg text-[11px] block truncate">{fmtBackupStamp(b.stamp)}</time>
						<span className="text-muted text-[10px] block truncate">
							{b.author ? `by ${b.author.username}` : "author unknown"}
						</span>
					</div>
					<button
						type="button"
						onClick={() => onRestore(b.stamp)}
						className="text-[11px] px-2 py-0.5 bg-bg-3 hover:bg-[#283040] border border-border rounded cursor-pointer shrink-0"
					>
						Restore
					</button>
				</li>
			))}
		</ul>
	);
}

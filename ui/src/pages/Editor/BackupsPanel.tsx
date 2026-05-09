import { fmtBackupStamp } from "../../lib/format";

interface Props {
	backups: { stamp: string }[];
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
					<time className="text-muted text-[11px]">{fmtBackupStamp(b.stamp)}</time>
					<button
						type="button"
						onClick={() => onRestore(b.stamp)}
						className="text-[11px] px-2 py-0.5 bg-bg-3 hover:bg-[#283040] border border-border rounded cursor-pointer"
					>
						Restore
					</button>
				</li>
			))}
		</ul>
	);
}

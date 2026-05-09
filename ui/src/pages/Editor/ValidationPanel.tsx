import type { ValidationResult } from "../../lib/api";

export function ValidationPanel({ parse }: { parse: ValidationResult | null }): JSX.Element {
	if (!parse || parse.ok) {
		return <div className="text-xs text-muted py-1.5">No issues.</div>;
	}
	return (
		<ul className="text-xs space-y-1 max-h-[240px] overflow-y-auto">
			{parse.errors.map((err, i) => (
				<li key={i} className="bg-[#2a1a1f] text-[#f4b9b2] px-2 py-1.5 rounded">
					{err.path && (
						<code className="bg-[#3a2229] text-[#f4b9b2] px-1 rounded mr-1">{err.path}</code>
					)}
					{err.message}
				</li>
			))}
		</ul>
	);
}

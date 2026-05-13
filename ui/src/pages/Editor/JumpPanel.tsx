import { useMemo } from "react";
import * as YAML from "yaml";

interface Props {
	yaml: string;
	onJump: (line: number) => void;
}

interface Entry {
	key: string;
	line: number;
}

export function JumpPanel({ yaml, onJump }: Props): JSX.Element {
	const entries = useMemo(() => topLevelKeys(yaml), [yaml]);

	if (entries.length === 0) {
		return <div className="text-xs text-muted py-1.5">No top-level keys found.</div>;
	}

	return (
		<ul className="text-xs max-h-[240px] overflow-y-auto">
			{entries.map(e => (
				<li key={e.key}>
					<button
						type="button"
						onClick={() => onJump(e.line)}
						className="w-full flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-bg-3 cursor-pointer text-left"
						title={`Jump to line ${e.line}`}
					>
						<span className="mono text-fg truncate">{e.key}</span>
						<span className="mono text-[10px] text-muted shrink-0">L{e.line}</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function topLevelKeys(text: string): Entry[] {
	let doc: YAML.Document.Parsed;
	try {
		doc = YAML.parseDocument(text);
	} catch {
		return [];
	}
	const root = doc.contents;
	if (!root || !YAML.isMap(root)) return [];

	const out: Entry[] = [];
	for (const pair of root.items) {
		const key = pair.key;
		if (!YAML.isScalar(key) || typeof key.value !== "string") continue;
		const offset = key.range?.[0] ?? 0;
		const line = countLines(text, offset);
		out.push({ key: key.value, line });
	}
	return out;
}

function countLines(text: string, offset: number): number {
	let n = 1;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) n++;
	}
	return n;
}

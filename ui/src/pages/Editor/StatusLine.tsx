import type { SaveStatus } from ".";

const COLOR: Record<SaveStatus["tone"], string> = {
	ok: "text-ok",
	warn: "text-warn",
	err: "text-err",
	info: "text-fg"
};

export function StatusLine({ status }: { status: SaveStatus }): JSX.Element {
	return <div className={`text-sm ${COLOR[status.tone]}`}>{status.message}</div>;
}

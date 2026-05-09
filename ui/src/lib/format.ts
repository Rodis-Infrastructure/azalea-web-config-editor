/** Shared formatters for timestamps and Discord-flavoured display. */

export function fmtTimestamp(epochMs: number | undefined | null): string {
	if (!epochMs) return "—";
	return new Date(epochMs).toLocaleString();
}

/** Backup stamps are ISO with `:` and `.` replaced by `-` for filesystem safety. */
export function fmtBackupStamp(stamp: string): string {
	const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/);
	if (!m) return stamp;
	const [, ymd, h, mm, ss] = m;
	return new Date(`${ymd}T${h}:${mm}:${ss}Z`).toLocaleString();
}

export function discordChannelPrefix(type: number): string {
	switch (type) {
		case 0: return "#";
		case 2: return "🔊 ";
		case 4: return "📁 ";
		case 5: return "📢 ";
		case 10:
		case 11:
		case 12: return "🧵 ";
		case 13: return "🎤 ";
		case 15: return "💬 ";
		case 16: return "🎞️ ";
		default: return "#";
	}
}

/** Short, human-readable name for a Discord channel type. */
export function discordChannelTypeName(type: number): string {
	switch (type) {
		case 0: return "text";
		case 2: return "voice";
		case 4: return "category";
		case 5: return "announcement";
		case 10: return "news thread";
		case 11: return "thread";
		case 12: return "private thread";
		case 13: return "stage";
		case 14: return "directory";
		case 15: return "forum";
		case 16: return "media";
		default: return `type ${type}`;
	}
}

export function colorIntToHex(color: number): string {
	if (!color) return "transparent";
	return "#" + color.toString(16).padStart(6, "0");
}

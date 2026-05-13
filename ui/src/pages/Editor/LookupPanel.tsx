import { useMemo, useRef, useState } from "react";
import type { DiscordChannel, DiscordRole } from "../../lib/api";
import { colorIntToHex, discordChannelPrefix, discordChannelTypeName } from "../../lib/format";

interface Props {
	channels: DiscordChannel[] | null;
	roles: DiscordRole[] | null;
}

type Tab = "channels" | "roles";

export function LookupPanel({ channels, roles }: Props): JSX.Element {
	const [tab, setTab] = useState<Tab>("channels");
	const [filter, setFilter] = useState("");
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const filtered = useMemo(() => {
		const f = filter.toLowerCase();
		if (tab === "channels") {
			return (channels ?? [])
				.slice()
				.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
				.filter(c => !f || c.name.toLowerCase().includes(f) || c.id.includes(f));
		}
		return (roles ?? [])
			.slice()
			.sort((a, b) => b.position - a.position)
			.filter(r => !f || r.name.toLowerCase().includes(f) || r.id.includes(f));
	}, [tab, filter, channels, roles]);

	const copy = async (id: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(id);
		} catch {
			// Clipboard API can be blocked on http:// origins; fall back to
			// the legacy execCommand path.
			const ta = document.createElement("textarea");
			ta.value = id;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			document.body.removeChild(ta);
		}
		setCopiedId(id);
		if (copyTimer.current) clearTimeout(copyTimer.current);
		copyTimer.current = setTimeout(() => {
			setCopiedId(prev => (prev === id ? null : prev));
		}, 1200);
	};

	return (
		<div className="space-y-2">
			<div className="flex gap-1">
				<TabBtn active={tab === "channels"} onClick={() => setTab("channels")}>Channels</TabBtn>
				<TabBtn active={tab === "roles"} onClick={() => setTab("roles")}>Roles</TabBtn>
			</div>
			<input
				type="search"
				value={filter}
				onChange={e => setFilter(e.target.value)}
				placeholder="Filter…"
				className="w-full bg-bg-3 border border-border rounded px-2 py-1 text-xs"
			/>
			<ul className="text-xs max-h-[240px] overflow-y-auto">
				{filtered.length === 0 ? (
					<li className="text-muted py-1.5">{tab === "channels" ? "No channels match." : "No roles match."}</li>
				) : (
					filtered.map(item => {
						const copied = copiedId === item.id;
						return (
							<li
								key={item.id}
								onClick={() => copy(item.id)}
								className={
									"py-1 px-1.5 rounded cursor-pointer transition-colors " +
									(copied ? "bg-ok/15" : "hover:bg-bg-3")
								}
								title={`Click to copy ${item.id}`}
							>
								<div className="flex items-center gap-2 min-w-0">
									<span className="flex-1 min-w-0 truncate text-fg">
										{tab === "channels"
											? `${discordChannelPrefix((item as DiscordChannel).type)}${item.name}`
											: <><RoleDot color={(item as DiscordRole).color} />{item.name}</>}
									</span>
									{tab === "channels" && (
										<span className="text-[10px] uppercase tracking-wider text-muted shrink-0">
											{discordChannelTypeName((item as DiscordChannel).type)}
										</span>
									)}
								</div>
								<div
									className={
										"mono text-[10px] truncate " +
										(copied ? "text-ok" : "text-muted")
									}
								>
									{copied ? "✓ copied" : item.id}
								</div>
							</li>
						);
					})
				)}
			</ul>
		</div>
	);
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				"flex-1 px-2 py-1 text-[11px] rounded border cursor-pointer " +
				(active ? "bg-accent border-accent text-white" : "bg-bg-3 border-border text-muted hover:text-fg")
			}
		>
			{children}
		</button>
	);
}

function RoleDot({ color }: { color: number }): JSX.Element {
	return (
		<span
			className="inline-block w-2 h-2 rounded-full mr-1.5 align-baseline"
			style={{ background: colorIntToHex(color) }}
		/>
	);
}

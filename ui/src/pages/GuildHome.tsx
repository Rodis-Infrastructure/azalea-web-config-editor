import { Link, useParams } from "react-router-dom";
import type { Me } from "../lib/api";

interface Feature {
	to: string;
	title: string;
	description: string;
	available: boolean;
	disabledReason?: string;
}

export function GuildHome({ me }: { me: Me }): JSX.Element {
	const { guildId = "" } = useParams();
	const guild = me.manageableGuilds.find(g => g.id === guildId);

	const features: Feature[] = [
		{
			to: `/g/${guildId}/config`,
			title: "Config editor",
			description: "Edit the bot's YAML config for this guild. Live validation, backups, audit trail.",
			available: true
		},
		{
			to: `/g/${guildId}/webhook-builder`,
			title: "Webhook builder",
			description: "Compose, send, and edit messages through any Discord webhook. Save messages for later edits.",
			available: true
		}
	];

	return (
		<div>
			<div className="flex items-center gap-3 mb-6">
				<Link
					to="/"
					className="text-sm text-muted hover:text-fg border border-border rounded px-3 py-1.5 bg-bg-3 hover:bg-bg-2"
				>
					← Guilds
				</Link>
				<div className="min-w-0">
					<h1 className="font-semibold truncate">{guild?.name ?? guildId}</h1>
					<div className="text-[11px] mono text-muted truncate">{guildId}</div>
				</div>
			</div>

			<ul className="grid gap-3 auto-rows-fr grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
				{features.map(f => (
					<li key={f.to} className="h-full">
						{f.available ? (
							<Link
								to={f.to}
								className="h-full flex flex-col p-4 bg-bg-2 border border-border rounded-md hover:border-accent transition-colors"
							>
								<div className="font-medium mb-1">{f.title}</div>
								<div className="text-sm text-muted">{f.description}</div>
							</Link>
						) : (
							<div
								className="h-full flex flex-col p-4 bg-bg-2 border border-border rounded-md opacity-50 cursor-not-allowed"
								title={f.disabledReason}
							>
								<div className="font-medium mb-1">{f.title}</div>
								<div className="text-sm text-muted">{f.description}</div>
								{f.disabledReason && (
									<div className="text-xs text-warn mt-2">{f.disabledReason}</div>
								)}
							</div>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

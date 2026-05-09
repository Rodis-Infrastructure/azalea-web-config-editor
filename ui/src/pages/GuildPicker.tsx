import { Link } from "react-router-dom";
import type { Me } from "../lib/api";

export function GuildPicker({ me }: { me: Me }): JSX.Element {
	if (me.manageableGuilds.length === 0) {
		return (
			<div>
				<h1 className="text-xl font-semibold mb-2">Manageable guilds</h1>
				<p className="text-muted">
					No guilds available. You either don't have{" "}
					<code className="bg-bg-3 px-1 rounded text-code text-sm">manage_guild_config</code>{" "}
					in any guild the bot is in, or you're not in{" "}
					<code className="bg-bg-3 px-1 rounded text-code text-sm">BOOTSTRAP_USER_IDS</code>.
				</p>
			</div>
		);
	}

	return (
		<div>
			<h1 className="text-xl font-semibold mb-2">Manageable guilds</h1>
			<p className="text-muted mb-4">
				Guilds where the bot is present and you have{" "}
				<code className="bg-bg-3 px-1 rounded text-code text-sm">manage_guild_config</code>.
			</p>

			<ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
				{me.manageableGuilds.map(g => (
					<li key={g.id}>
						<Link
							to={`/g/${g.id}`}
							className="flex items-center gap-3 p-3.5 bg-bg-2 border border-border rounded-md hover:border-accent transition-colors"
						>
							<GuildIcon id={g.id} icon={g.icon} name={g.name} />
							<div className="min-w-0">
								<div className="font-medium truncate">{g.name}</div>
								<div className={`text-xs mt-0.5 ${g.via === "bootstrap" ? "text-warn" : "text-muted"}`}>
									{g.id} · {g.via}
								</div>
							</div>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function GuildIcon({ id, icon, name }: { id: string; icon: string | null; name: string }): JSX.Element {
	if (icon) {
		return (
			<img
				src={`https://cdn.discordapp.com/icons/${id}/${icon}.png?size=64`}
				alt=""
				className="w-9 h-9 rounded-full bg-bg-3 object-cover flex-shrink-0"
			/>
		);
	}
	return (
		<div className="w-9 h-9 rounded-full bg-bg-3 flex items-center justify-center flex-shrink-0 text-base font-semibold text-muted">
			{name.slice(0, 2).toUpperCase()}
		</div>
	);
}

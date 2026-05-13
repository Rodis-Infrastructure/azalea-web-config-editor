// OAuth `identify` + `guilds` scopes only. Per-guild permission checks
// use the bot token (not the user's) — avoids needing
// `guilds.members.read` consent per guild.
import { randomBytes } from "node:crypto";
import { env } from "@lib/env";
import { fetchMember, type DiscordMember } from "@lib/discord";
import { Permission, type RawGuildConfig } from "@/schema";

const DISCORD_OAUTH = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_USER = "https://discord.com/api/users/@me";
const DISCORD_USER_GUILDS = "https://discord.com/api/users/@me/guilds";
const SCOPES = "identify guilds";

const DISCORD_FETCH_TIMEOUT_MS = 10_000;

export interface DiscordUser {
	id: string;
	username: string;
	avatar: string | null;
}

export interface UserGuild {
	id: string;
	name: string;
	icon: string | null;
}

export function buildAuthorizeUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: env.discord.clientId,
		redirect_uri: env.discord.redirectUri,
		response_type: "code",
		scope: SCOPES,
		state,
		prompt: "none"
	});
	return `${DISCORD_OAUTH}?${params}`;
}

export function generateState(): string {
	return randomBytes(16).toString("base64url");
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
	const body = new URLSearchParams({
		client_id: env.discord.clientId,
		client_secret: env.discord.clientSecret,
		grant_type: "authorization_code",
		code,
		redirect_uri: env.discord.redirectUri
	});
	const res = await fetch(DISCORD_TOKEN, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
		signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`OAuth code exchange failed (${res.status}): ${text}`);
	}
	return await res.json() as TokenResponse;
}

export async function fetchOAuthUser(accessToken: string): Promise<DiscordUser> {
	const res = await fetch(DISCORD_USER, {
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Failed to fetch Discord user (${res.status})`);
	const user = await res.json() as DiscordUser;
	return { id: user.id, username: user.username, avatar: user.avatar };
}

export async function fetchOAuthGuilds(accessToken: string): Promise<UserGuild[]> {
	const res = await fetch(DISCORD_USER_GUILDS, {
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Failed to fetch user guilds (${res.status})`);
	const arr = await res.json() as UserGuild[];
	return arr.map(g => ({ id: g.id, name: g.name, icon: g.icon }));
}

// Mirrors `GuildConfig.hasPermission` in the bot. The `via` field is
// recorded in the audit log so a bootstrap-bypass is distinguishable
// from a normal permission grant.
export async function authorizeGuildEdit(
	userId: string,
	guildId: string,
	config: RawGuildConfig | null
): Promise<{ allowed: true; via: "bootstrap" | "permission" } | { allowed: false; reason: string }> {
	if (env.bootstrapUserIds.has(userId)) {
		return { allowed: true, via: "bootstrap" };
	}

	if (!config?.permissions || config.permissions.length === 0) {
		return { allowed: false, reason: "No permissions configured for this guild yet — bootstrap an admin first" };
	}

	let member: DiscordMember | null;
	try {
		member = await fetchMember(guildId, userId);
	} catch (err) {
		return { allowed: false, reason: `Failed to verify membership: ${err instanceof Error ? err.message : String(err)}` };
	}

	if (!member) {
		return { allowed: false, reason: "Not a member of this guild" };
	}

	const memberRoleIds = new Set(member.roles);
	const granted = config.permissions.some(p =>
		p.allow.includes(Permission.ManageGuildConfig) &&
		p.roles.some(roleId => memberRoleIds.has(roleId))
	);

	return granted
		? { allowed: true, via: "permission" }
		: { allowed: false, reason: "Missing manage_guild_config permission" };
}

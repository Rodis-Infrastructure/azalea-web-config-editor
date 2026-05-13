// Bot-token-backed Discord REST helpers. Cached in-process for
// CACHE_TTL_MS — except `fetchMember`, which auth decisions depend on
// and so always hits the network.
import { env } from "@lib/env";

const DISCORD_API = "https://discord.com/api/v10";
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

interface CacheEntry<T> {
	expiresAt: number;
	value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function botAuthHeaders(): Record<string, string> {
	return { Authorization: `Bot ${env.discord.botToken}` };
}

async function discordGet<T>(path: string, cacheKey?: string): Promise<T> {
	const key = cacheKey ?? path;
	const hit = cache.get(key);
	if (hit && hit.expiresAt > Date.now()) {
		return hit.value as T;
	}

	const res = await fetch(`${DISCORD_API}${path}`, {
		headers: botAuthHeaders(),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new DiscordError(res.status, `Discord API ${res.status} for ${path}: ${body}`);
	}

	const value = await res.json() as T;
	cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
	return value;
}

export class DiscordError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
	}
}

export interface DiscordChannel {
	id: string;
	name: string;
	type: number;
	parent_id: string | null;
	position: number;
}

export interface DiscordRole {
	id: string;
	name: string;
	color: number;
	position: number;
	managed: boolean;
}

export interface DiscordEmoji {
	id: string | null;
	name: string;
	animated: boolean;
}

export interface DiscordMember {
	user: { id: string; username: string };
	roles: string[];
	nick: string | null;
}

export function listChannels(guildId: string): Promise<DiscordChannel[]> {
	return discordGet<DiscordChannel[]>(`/guilds/${guildId}/channels`, `channels:${guildId}`);
}

export function listRoles(guildId: string): Promise<DiscordRole[]> {
	return discordGet<DiscordRole[]>(`/guilds/${guildId}/roles`, `roles:${guildId}`);
}

export function listEmojis(guildId: string): Promise<DiscordEmoji[]> {
	return discordGet<DiscordEmoji[]>(`/guilds/${guildId}/emojis`, `emojis:${guildId}`);
}

export async function fetchMember(guildId: string, userId: string): Promise<DiscordMember | null> {
	const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
		headers: botAuthHeaders(),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new DiscordError(res.status, `fetchMember(${guildId}, ${userId}) -> ${res.status}: ${body}`);
	}
	return await res.json() as DiscordMember;
}

export interface DiscordGuildSummary {
	id: string;
	name: string;
	icon: string | null;
	owner_id: string;
}

export function fetchGuild(guildId: string): Promise<DiscordGuildSummary> {
	return discordGet<DiscordGuildSummary>(`/guilds/${guildId}`, `guild:${guildId}`);
}

export function _clearCacheForTesting(): void {
	cache.clear();
}

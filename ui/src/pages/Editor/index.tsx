import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, type AuditEvent, type BackupSummary, type ConfigPayload, type DiscordChannel, type DiscordRole, type Me, type SaveOutcome, type ValidationResult } from "../../lib/api";
import { fmtTimestamp } from "../../lib/format";
import { RawYamlTab } from "./RawYamlTab";
import { BackupsPanel } from "./BackupsPanel";
import { AuditPanel } from "./AuditPanel";
import { LookupPanel } from "./LookupPanel";
import { VersionBanner } from "./VersionBanner";
import { ValidationPanel } from "./ValidationPanel";
import { StatusLine } from "./StatusLine";

export interface SaveStatus {
	tone: "ok" | "warn" | "err" | "info";
	message: string;
}

export function EditorPage({ me }: { me: Me }): JSX.Element {
	const { guildId = "" } = useParams();
	const navigate = useNavigate();

	const guildSummary = useMemo(
		() => me.manageableGuilds.find(g => g.id === guildId),
		[me.manageableGuilds, guildId]
	);

	const [yaml, setYaml] = useState("");
	const [originalYaml, setOriginalYaml] = useState("");
	const [mtimeMs, setMtimeMs] = useState<number | null>(null);
	const [parse, setParse] = useState<ValidationResult | null>(null);
	const [status, setStatus] = useState<SaveStatus>({ tone: "info", message: "Loading…" });
	const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
	const [backups, setBackups] = useState<BackupSummary[]>([]);
	const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
	const [roles, setRoles] = useState<DiscordRole[] | null>(null);
	const [saving, setSaving] = useState(false);

	const refreshAudit = useCallback(async () => {
		const res = await api<{ events: AuditEvent[] }>(`/api/guilds/${guildId}/audit?limit=20`);
		if (res.ok) setAuditEvents(res.body.events);
	}, [guildId]);

	const refreshBackups = useCallback(async () => {
		const res = await api<{ backups: BackupSummary[] }>(`/api/guilds/${guildId}/config/backups`);
		if (res.ok) setBackups(res.body.backups);
	}, [guildId]);

	const [lookupRefreshing, setLookupRefreshing] = useState(false);
	const refreshLookup = useCallback(async () => {
		setLookupRefreshing(true);
		const [c, r] = await Promise.all([
			api<DiscordChannel[]>(`/api/guilds/${guildId}/discord/channels`),
			api<DiscordRole[]>(`/api/guilds/${guildId}/discord/roles`)
		]);
		if (c.ok) setChannels(c.body);
		if (r.ok) setRoles(r.body);
		setLookupRefreshing(false);
	}, [guildId]);

	useEffect(() => {
		void (async () => {
			setStatus({ tone: "info", message: "Loading…" });
			const cfg = await api<ConfigPayload>(`/api/guilds/${guildId}/config`);
			if (!cfg.ok) {
				setStatus({ tone: "err", message: `Failed to load config (HTTP ${cfg.status})` });
				return;
			}
			const fresh = cfg.body.yaml ?? "";
			setYaml(fresh);
			setOriginalYaml(fresh);
			setMtimeMs(cfg.body.mtimeMs ?? null);
			setParse(cfg.body.parse);
			setStatus(
				cfg.body.mtimeMs
					? { tone: "info", message: `Last saved ${fmtTimestamp(cfg.body.mtimeMs)}` }
					: { tone: "info", message: "New (no file yet)" }
			);
			await Promise.all([refreshAudit(), refreshBackups(), refreshLookup()]);
		})();
	}, [guildId, refreshAudit, refreshBackups, refreshLookup]);

	// Debounced live validate.
	const validateSeq = useRef(0);
	useEffect(() => {
		if (!yaml && yaml !== "") return; // Initial empty before load
		const handle = setTimeout(async () => {
			const seq = ++validateSeq.current;
			const res = await api<ValidationResult>(`/api/guilds/${guildId}/config/validate`, {
				method: "POST",
				body: JSON.stringify({ yaml })
			});
			if (seq !== validateSeq.current || !res.ok) return;
			setParse(res.body);
		}, 400);
		return () => clearTimeout(handle);
	}, [yaml, guildId]);

	const onSave = useCallback(async (): Promise<void> => {
		setSaving(true);
		setStatus({ tone: "warn", message: "Saving and reloading the bot…" });
		const res = await api<SaveOutcome>(`/api/guilds/${guildId}/config`, {
			method: "POST",
			body: JSON.stringify({ yaml, expectedMtimeMs: mtimeMs ?? undefined })
		});
		setSaving(false);

		const body = res.body;
		if (res.ok && body.status === "saved") {
			setMtimeMs(Date.now());
			setOriginalYaml(yaml);
			setStatus({ tone: "ok", message: `Saved · bot started at ${fmtTimestamp(new Date(body.startedAt!).getTime())}` });
			setParse({ ok: true, parsed: null });
			await Promise.all([refreshAudit(), refreshBackups()]);
			return;
		}
		if (body.status === "validation_failed") {
			setParse({ ok: false, stage: "schema", errors: body.errors ?? [] });
			setStatus({ tone: "err", message: `Validation failed (${body.errors?.length ?? 0} ${body.errors?.length === 1 ? "issue" : "issues"})` });
			return;
		}
		if (body.status === "conflict") {
			setStatus({ tone: "err", message: "Conflict — config changed on disk. Reload the page." });
			return;
		}
		if (body.status === "rolled_back") {
			setStatus({ tone: "warn", message: `Rolled back: ${body.reason}. Bot is running the previous config.` });
			await refreshAudit();
			return;
		}
		if (body.status === "degraded") {
			setStatus({ tone: "err", message: `Degraded: ${body.reason}. Check pm2 logs.` });
			return;
		}
		setStatus({ tone: "err", message: `Unexpected response: ${JSON.stringify(body)}` });
	}, [guildId, yaml, mtimeMs, refreshAudit, refreshBackups]);

	const onValidate = useCallback(async (): Promise<void> => {
		const res = await api<ValidationResult>(`/api/guilds/${guildId}/config/validate`, {
			method: "POST",
			body: JSON.stringify({ yaml })
		});
		if (!res.ok) {
			setStatus({ tone: "err", message: `Validate failed (HTTP ${res.status})` });
			return;
		}
		setParse(res.body);
		setStatus(
			res.body.ok
				? { tone: "ok", message: "Valid" }
				: { tone: "err", message: `Invalid (${res.body.errors.length} ${res.body.errors.length === 1 ? "issue" : "issues"})` }
		);
	}, [guildId, yaml]);

	const isDirty = yaml !== originalYaml;
	const isInvalid = parse !== null && parse.ok === false;
	const onReset = useCallback((): void => {
		if (!isDirty) return;
		if (!confirm("Discard your unsaved edits and revert to the last loaded config?")) return;
		setYaml(originalYaml);
		setStatus({ tone: "info", message: "Reverted to last loaded config." });
	}, [isDirty, originalYaml]);

	const onRestore = useCallback(async (stamp: string): Promise<void> => {
		if (!confirm(`Restore backup from ${stamp}? The bot will reload.`)) return;
		setStatus({ tone: "warn", message: "Restoring…" });
		const res = await api<SaveOutcome>(`/api/guilds/${guildId}/config/restore`, {
			method: "POST",
			body: JSON.stringify({ stamp, expectedMtimeMs: mtimeMs ?? undefined })
		});
		if (res.ok && res.body.status === "saved") {
			// Reload the editor state.
			navigate(0);
			return;
		}
		setStatus({ tone: "err", message: `Restore failed: ${res.body.status ?? res.status}` });
	}, [guildId, mtimeMs, navigate]);

	return (
		<div className="flex-1 min-h-0 flex flex-col">
			<VersionBanner />

			<div className="flex items-center gap-3 mb-4">
				<Link
					to="/"
					className="text-sm text-muted hover:text-fg border border-border rounded px-3 py-1.5 bg-bg-3 hover:bg-bg-2"
				>
					← Guilds
				</Link>
				<div className="flex-1 min-w-0 flex items-center gap-2">
					<span className="font-semibold truncate">{guildSummary?.name ?? guildId}</span>
					{isDirty && (
						<span
							className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-warn"
							title="You have unsaved edits."
						>
							<span className="w-1.5 h-1.5 rounded-full bg-warn" /> edited
						</span>
					)}
				</div>

				<button
					type="button"
					onClick={onReset}
					disabled={!isDirty}
					className="text-sm border border-border rounded px-3.5 py-1.5 bg-bg-3 hover:bg-bg-2 disabled:opacity-40 disabled:cursor-not-allowed"
					title={isDirty ? "Discard unsaved edits" : "No edits to reset"}
				>
					Reset
				</button>
				<button
					type="button"
					onClick={onValidate}
					className="text-sm border border-border rounded px-3.5 py-1.5 bg-bg-3 hover:bg-bg-2"
				>
					Validate
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={saving || isInvalid}
					className="text-sm bg-accent hover:bg-accent-hover text-white rounded px-3.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
					title={isInvalid ? "Fix validation errors before saving" : undefined}
				>
					{saving ? "Saving…" : "Save & reload"}
				</button>
			</div>

			<div className="grid grid-cols-[1fr_320px] gap-4 flex-1 min-h-0">
				<div className="min-w-0 min-h-0 h-full">
					<RawYamlTab
						value={yaml}
						onChange={setYaml}
						parse={parse}
						guildId={guildId}
						testEmbedEnabled={me.testWebhookConfigured}
						onStatus={setStatus}
					/>
				</div>

				<aside className="flex flex-col gap-3 overflow-y-auto pr-1">
					<Panel title="Status">
						<StatusLine status={status} />
					</Panel>
					<Panel title="Validation">
						<ValidationPanel parse={parse} />
					</Panel>
					<Panel
						title="Server lookup"
						action={
							<button
								type="button"
								onClick={refreshLookup}
								disabled={lookupRefreshing}
								className="text-[10px] uppercase tracking-wider text-muted hover:text-fg disabled:opacity-40 cursor-pointer flex items-center gap-1"
								title="Refetch channels and roles from Discord"
							>
								<RefreshIcon spinning={lookupRefreshing} />
								<span>{lookupRefreshing ? "Refreshing" : "Refresh"}</span>
							</button>
						}
					>
						<LookupPanel channels={channels} roles={roles} />
					</Panel>
					<Panel title="Backups">
						<BackupsPanel backups={backups} onRestore={onRestore} />
					</Panel>
					<Panel title="Recent activity">
						<AuditPanel events={auditEvents} />
					</Panel>
				</aside>
			</div>
		</div>
	);
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }): JSX.Element {
	return (
		<section className="bg-bg-2 border border-border rounded-md p-3">
			<div className="flex items-center justify-between mb-2">
				<h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

function RefreshIcon({ spinning }: { spinning: boolean }): JSX.Element {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 16 16"
			className={spinning ? "animate-spin" : ""}
			aria-hidden
		>
			<path
				d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 3v3h-3"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

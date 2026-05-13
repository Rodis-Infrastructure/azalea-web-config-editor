import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as YAML from "yaml";
import Editor, { type OnMount } from "@monaco-editor/react";
import { api, type Me, type SavedWebhookMessage, type WebhookProxyResult } from "../../lib/api";
import { fmtTimestamp } from "../../lib/format";
import { THEME_NAME, ensureTheme } from "../../lib/monaco-theme";

interface DiscordMessage {
	id: string;
	channel_id?: string;
	content?: string;
	[k: string]: unknown;
}

type Status =
	| { tone: "info"; message: string }
	| { tone: "ok"; message: string }
	| { tone: "warn"; message: string }
	| { tone: "err"; message: string }
	| null;

export function WebhookBuilder({ me }: { me: Me }): JSX.Element {
	const { guildId = "" } = useParams();
	const guild = me.manageableGuilds.find(g => g.id === guildId);

	const [webhookUrl, setWebhookUrl] = useState("");
	const [messageId, setMessageId] = useState("");
	const [threadId, setThreadId] = useState("");
	const [username, setUsername] = useState("");
	const [avatarUrl, setAvatarUrl] = useState("");
	const [content, setContent] = useState("");
	const [embedsText, setEmbedsText] = useState("");
	const [saveName, setSaveName] = useState("");
	const [suppressMentions, setSuppressMentions] = useState(true);
	const [saveOnSend, setSaveOnSend] = useState(true);
	const [sending, setSending] = useState(false);
	const [status, setStatus] = useState<Status>(null);
	const [lastResponse, setLastResponse] = useState<DiscordMessage | null>(null);
	const [saved, setSaved] = useState<SavedWebhookMessage[]>([]);

	const refreshSaved = useCallback(async () => {
		const res = await api<{ messages: SavedWebhookMessage[] }>(
			`/api/guilds/${guildId}/webhook/saved`
		);
		if (res.ok) setSaved(res.body.messages);
	}, [guildId]);

	useEffect(() => { void refreshSaved(); }, [refreshSaved]);

	const editing = messageId.trim() !== "";
	const isTestConfigured = me.testWebhookConfigured;

	const parsedEmbeds = useMemo(() => parseEmbedsText(embedsText), [embedsText]);
	const detectedLang = useMemo(() => detectEmbedLang(embedsText), [embedsText]);

	const onEmbedsEditorMount: OnMount = (_editor, monaco) => {
		ensureTheme(monaco);
		monaco.editor.setTheme(THEME_NAME);
	};

	const buildPayload = (): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } => {
		if (parsedEmbeds.error) {
			return { ok: false, error: parsedEmbeds.error };
		}
		const payload: Record<string, unknown> = {};
		if (content.trim() !== "") payload.content = content;
		if (parsedEmbeds.value.length > 0) payload.embeds = parsedEmbeds.value;

		if (!editing) {
			// Identity overrides only allowed on create.
			if (username.trim() !== "") payload.username = username.trim();
			if (avatarUrl.trim() !== "") payload.avatar_url = avatarUrl.trim();
		}

		if (suppressMentions) {
			payload.allowed_mentions = { parse: [] };
		}

		const hasContent = "content" in payload || "embeds" in payload;
		if (!hasContent) {
			return { ok: false, error: "Message needs either content or at least one embed." };
		}
		return { ok: true, payload };
	};

	const fireProxy = async (target: "custom" | "test"): Promise<void> => {
		setStatus(null);
		setLastResponse(null);

		if (target === "custom" && !webhookUrl.trim()) {
			setStatus({ tone: "err", message: "Enter a webhook URL." });
			return;
		}

		const build = buildPayload();
		if (!build.ok) {
			setStatus({ tone: "err", message: build.error });
			return;
		}

		setSending(true);
		const proxy = await api<WebhookProxyResult>(`/api/guilds/${guildId}/webhook/proxy`, {
			method: "POST",
			body: JSON.stringify({
				target,
				webhookUrl: target === "custom" ? webhookUrl.trim() : undefined,
				messageId: editing ? messageId.trim() : undefined,
				threadId: threadId.trim() || undefined,
				payload: build.payload
			})
		});
		setSending(false);

		if (!proxy.ok) {
			setStatus({
				tone: "err",
				message: `Proxy error (HTTP ${proxy.status}): ${describeProxyError(proxy.body)}`
			});
			return;
		}
		if (!proxy.body.ok) {
			setStatus({
				tone: "err",
				message: `Discord rejected (HTTP ${proxy.body.status}): ${describeDiscordError(proxy.body.body)}`
			});
			return;
		}

		const message = isMessageObject(proxy.body.body) ? proxy.body.body : null;
		setLastResponse(message);

		if (editing) {
			setStatus({
				tone: "ok",
				message: `Edited message ${messageId.trim()}.`
			});
		} else if (target === "test") {
			setStatus({
				tone: "ok",
				message: `Sent to TEST_WEBHOOK_URL${message ? ` · message ${message.id}` : ""}.`
			});
		} else {
			setStatus({
				tone: "ok",
				message: `Sent${message ? ` · message ${message.id}` : ""}.`
			});

			if (saveOnSend && message && target === "custom") {
				const save = await api<{ ok: boolean; id: number; error?: string }>(
					`/api/guilds/${guildId}/webhook/saved`,
					{
						method: "POST",
						body: JSON.stringify({
							webhookUrl: webhookUrl.trim(),
							messageId: message.id,
							threadId: threadId.trim() || undefined,
							contentPreview: (content || "(embed-only)").slice(0, 200),
							name: saveName.trim() || undefined
						})
					}
				);
				if (save.ok && save.body.ok) {
					setSaveName("");
					await refreshSaved();
				}
			}
		}
	};

	const onLoadSaved = (s: SavedWebhookMessage): void => {
		setWebhookUrl(s.webhookUrl);
		setMessageId(s.messageId);
		setThreadId(s.threadId ?? "");
		setStatus({
			tone: "info",
			message: `Loaded ${s.name?.trim() ? `"${s.name.trim()}"` : "saved entry"}. Editing message ${s.messageId}.`
		});
	};

	const onDeleteSaved = async (s: SavedWebhookMessage): Promise<void> => {
		if (!confirm(`Forget saved message ${s.messageId}? This doesn't delete the message on Discord.`)) return;
		const res = await api<{ ok: boolean }>(
			`/api/guilds/${guildId}/webhook/saved/${s.id}`,
			{ method: "DELETE" }
		);
		if (res.ok) await refreshSaved();
	};

	return (
		<div className="flex-1 min-h-0 flex flex-col">
			<div className="flex items-center gap-3 mb-4">
				<Link
					to={`/g/${guildId}`}
					className="text-sm text-muted hover:text-fg border border-border rounded px-3 py-1.5 bg-bg-3 hover:bg-bg-2"
				>
					← Server
				</Link>
				<div className="flex-1 min-w-0">
					<div className="font-semibold truncate">Webhook builder</div>
					<div className="text-[11px] text-muted truncate">{guild?.name ?? guildId}</div>
				</div>
				<button
					type="button"
					onClick={() => void fireProxy("test")}
					disabled={sending || !isTestConfigured}
					title={isTestConfigured ? "Sends to TEST_WEBHOOK_URL with the current form" : "TEST_WEBHOOK_URL is not configured on the server"}
					className="text-sm border border-border rounded px-3.5 py-1.5 bg-bg-3 hover:bg-bg-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				>
					{sending ? "…" : "Send test"}
				</button>
				<button
					type="button"
					onClick={() => void fireProxy("custom")}
					disabled={sending}
					className="text-sm bg-accent hover:bg-accent-hover text-white rounded px-3.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				>
					{sending ? (editing ? "Editing…" : "Sending…") : (editing ? "Save edit" : "Send")}
				</button>
			</div>

			<div className="grid grid-cols-[1fr_320px] gap-4 flex-1 min-h-0">
				<div className="min-w-0 min-h-0 overflow-y-auto pr-1 space-y-3">
					<Field label="Webhook URL">
						<input
							type="url"
							value={webhookUrl}
							onChange={e => setWebhookUrl(e.target.value)}
							placeholder="https://discord.com/api/webhooks/…"
							className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs mono"
							spellCheck={false}
							autoComplete="off"
						/>
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field
							label="Message ID (optional — edits if set)"
							hint={editing ? "Identity overrides ignored when editing." : undefined}
						>
							<input
								type="text"
								value={messageId}
								onChange={e => setMessageId(e.target.value)}
								placeholder="123456789012345678"
								className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs mono"
								spellCheck={false}
							/>
						</Field>
						<Field label="Thread ID (optional)">
							<input
								type="text"
								value={threadId}
								onChange={e => setThreadId(e.target.value)}
								placeholder="123456789012345678"
								className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs mono"
								spellCheck={false}
							/>
						</Field>
					</div>

					{!editing && (
						<div className="grid grid-cols-2 gap-3">
							<Field label="Username override (optional)">
								<input
									type="text"
									value={username}
									onChange={e => setUsername(e.target.value)}
									maxLength={80}
									placeholder="Webhook display name"
									className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs"
								/>
							</Field>
							<Field label="Avatar URL (optional)">
								<input
									type="url"
									value={avatarUrl}
									onChange={e => setAvatarUrl(e.target.value)}
									placeholder="https://…"
									className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs mono"
								/>
							</Field>
						</div>
					)}

					<Field label="Content (optional · ≤ 2000 chars)" hint={`${content.length}/2000`}>
						<textarea
							value={content}
							onChange={e => setContent(e.target.value)}
							maxLength={2000}
							rows={5}
							placeholder="Plain text body…"
							className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs resize-y"
						/>
					</Field>

					<Field
						label={
							<span>
								Embeds (optional · YAML or JSON ·{" "}
								<a
									href="https://discord.com/developers/docs/resources/message#embed-object"
									target="_blank"
									rel="noreferrer"
									className="text-accent hover:underline"
								>
									schema reference ↗
								</a>
								)
							</span>
						}
						hint={
							parsedEmbeds.error
								? <span className="text-err">{parsedEmbeds.error}</span>
								: (
									<span>
										<span className="uppercase mono">{detectedLang}</span>
										{parsedEmbeds.value.length > 0 && (
											<> · {parsedEmbeds.value.length} embed{parsedEmbeds.value.length === 1 ? "" : "s"} parsed</>
										)}
									</span>
								)
						}
					>
						<div className="bg-bg-3 border border-border rounded overflow-hidden">
							<Editor
								height="260px"
								language={detectedLang}
								theme={THEME_NAME}
								value={embedsText}
								onChange={v => setEmbedsText(v ?? "")}
								onMount={onEmbedsEditorMount}
								options={{
									tabSize: 2,
									insertSpaces: false,
									minimap: { enabled: false },
									scrollBeyondLastLine: false,
									fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
									fontSize: 12,
									automaticLayout: true,
									padding: { top: 8, bottom: 8 },
									lineNumbers: "off",
									folding: false,
									renderLineHighlight: "none",
									overviewRulerLanes: 0,
									scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
								}}
							/>
						</div>
					</Field>

					<div className="flex flex-wrap items-center gap-4 text-xs">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={suppressMentions}
								onChange={e => setSuppressMentions(e.target.checked)}
							/>
							Disable mentions
						</label>
						<label className={"flex items-center gap-2 " + (editing ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
							<input
								type="checkbox"
								checked={saveOnSend && !editing}
								onChange={e => setSaveOnSend(e.target.checked)}
								disabled={editing}
							/>
							Save this message after sending
						</label>
					</div>

					{saveOnSend && !editing && (
						<input
							type="text"
							value={saveName}
							onChange={e => setSaveName(e.target.value)}
							maxLength={80}
							placeholder="Save as… (optional name — falls back to the content preview)"
							className="w-full bg-bg-3 border border-border rounded px-2 py-1.5 text-xs"
						/>
					)}

					{status && (
						<div
							className={
								"text-xs rounded border px-3 py-2 " +
								(status.tone === "ok" ? "border-ok/40 bg-ok/10 text-ok" :
								status.tone === "warn" ? "border-warn/40 bg-warn/10 text-warn" :
								status.tone === "err" ? "border-err/40 bg-err/10 text-err" :
								"border-border bg-bg-2 text-muted")
							}
						>
							{status.message}
						</div>
					)}

					{lastResponse && (
						<details className="text-xs">
							<summary className="cursor-pointer text-muted hover:text-fg">Discord response</summary>
							<pre className="mt-1 bg-bg-2 border border-border rounded p-2 mono overflow-x-auto">
								{JSON.stringify(lastResponse, null, 2)}
							</pre>
						</details>
					)}
				</div>

				<aside className="flex flex-col gap-3 overflow-y-auto pr-1">
					<section className="bg-bg-2 border border-border rounded-md p-3">
						<h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Saved messages</h3>
						{saved.length === 0 ? (
							<div className="text-xs text-muted py-1.5">No saves yet.</div>
						) : (
							<ul className="text-xs space-y-1.5">
								{saved.map(s => (
									<li key={s.id} className="bg-bg-3 border border-border rounded p-2">
										<div className="flex items-start justify-between gap-2">
											<button
												type="button"
												onClick={() => onLoadSaved(s)}
												className="flex-1 min-w-0 text-left cursor-pointer"
												title="Load into the form for editing"
											>
												<div className="text-fg font-medium truncate">
													{s.name?.trim() || s.contentPreview || "(embed-only)"}
												</div>
												{s.name && s.contentPreview && (
													<div className="text-[10px] text-muted truncate">{s.contentPreview}</div>
												)}
												<div className="mono text-[10px] text-muted truncate">{s.messageId}</div>
												<div className="text-[10px] text-muted">{fmtTimestamp(s.savedAt)}</div>
											</button>
											<button
												type="button"
												onClick={() => void onDeleteSaved(s)}
												className="text-[10px] text-muted hover:text-err cursor-pointer shrink-0"
												title="Forget this save (does not delete on Discord)"
											>
												forget
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="bg-bg-2 border border-border rounded-md p-3 text-xs text-muted">
						<h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Tips</h3>
						<ul className="space-y-1.5">
							<li>• Editing requires the original webhook + message ID. Discord rejects edits to messages a different webhook created.</li>
							<li>• Up to 10 embeds; total content ≤ 6000 chars.</li>
							<li>• Test button posts to <code className="mono text-code">TEST_WEBHOOK_URL</code>.</li>
							<li>• Saved entries store the webhook URL encrypted; clicking one preloads it for editing.</li>
						</ul>
					</section>
				</aside>
			</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }): JSX.Element {
	return (
		<label className="block">
			<div className="flex items-center justify-between mb-1 gap-2">
				<span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
				{hint && <span className="text-[10px] text-muted">{hint}</span>}
			</div>
			{children}
		</label>
	);
}

interface EmbedsParse {
	value: unknown[];
	error: string | null;
}

// Heuristic: starts with a JSON open bracket and parses cleanly → JSON.
// Anything else (empty, key-value lines, dashes, mixed) → YAML. Because
// YAML is a JSON superset, the actual `parseEmbedsText` parser uses YAML
// for both — this only drives syntax highlighting.
function detectEmbedLang(text: string): "json" | "yaml" {
	const trimmed = text.trim();
	if (trimmed === "") return "yaml";
	const first = trimmed[0];
	if (first === "{" || first === "[") {
		try {
			JSON.parse(trimmed);
			return "json";
		} catch {
			// Mid-typing JSON — fall through.
		}
	}
	return "yaml";
}

function parseEmbedsText(text: string): EmbedsParse {
	const trimmed = text.trim();
	if (trimmed === "") return { value: [], error: null };
	let parsed: unknown;
	try {
		parsed = YAML.parse(trimmed);
	} catch (err) {
		return { value: [], error: err instanceof Error ? err.message : String(err) };
	}
	if (parsed === null || parsed === undefined) return { value: [], error: null };
	if (Array.isArray(parsed)) {
		if (parsed.length > 10) return { value: [], error: "At most 10 embeds." };
		if (!parsed.every(item => isPlainObject(item))) {
			return { value: [], error: "Embed array must contain only objects." };
		}
		return { value: parsed, error: null };
	}
	if (isPlainObject(parsed)) {
		return { value: [parsed], error: null };
	}
	return { value: [], error: "Embeds must be an object or array of objects." };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessageObject(value: unknown): value is DiscordMessage {
	return typeof value === "object" && value !== null && "id" in value && typeof (value as DiscordMessage).id === "string";
}

function describeProxyError(body: unknown): string {
	if (typeof body === "object" && body !== null && "error" in body) {
		const v = (body as { error: unknown }).error;
		if (typeof v === "string") return v;
	}
	return "unknown";
}

function describeDiscordError(body: unknown): string {
	if (typeof body === "object" && body !== null) {
		const o = body as Record<string, unknown>;
		const message = typeof o.message === "string" ? o.message : null;
		const code = typeof o.code === "number" ? ` (code ${o.code})` : "";
		if (message) return message + code;
	}
	if (typeof body === "string") return body.slice(0, 300);
	return "unknown";
}

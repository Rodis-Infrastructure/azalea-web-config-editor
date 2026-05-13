import { useEffect, useRef, useState } from "react";
import Editor, { DiffEditor, type OnMount, type DiffOnMount } from "@monaco-editor/react";
import * as YAML from "yaml";
import { api, type ValidationResult } from "../../lib/api";
import type { SaveStatus } from "./index";

interface Props {
	value: string;
	onChange: (next: string) => void;
	originalValue: string;
	parse: ValidationResult | null;
	guildId: string;
	testEmbedEnabled: boolean;
	onStatus: (status: SaveStatus) => void;
	onEditorReady?: (editor: Parameters<OnMount>[0]) => void;
}

type Tab = "edit" | "diff";

const THEME_NAME = "azalea-dark";

// Mirrors the design tokens in styles.css.
function ensureTheme(monaco: Parameters<OnMount>[1]): void {
	monaco.editor.defineTheme(THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "8a93a1", fontStyle: "italic" },
			{ token: "string", foreground: "f4dbb5" },
			{ token: "string.yaml", foreground: "f4dbb5" },
			{ token: "number", foreground: "f0a020" },
			{ token: "type", foreground: "5469ff" },
			{ token: "type.yaml", foreground: "5469ff" }
		],
		colors: {
			"editor.background": "#161b22",
			"editor.foreground": "#e7ebf0",
			"editorCursor.foreground": "#5469ff",
			"editorLineNumber.foreground": "#4a525e",
			"editorLineNumber.activeForeground": "#8a93a1",
			"editor.lineHighlightBackground": "#1f2630",
			"editor.lineHighlightBorder": "#1f2630",
			"editor.selectionBackground": "#5469ff66",
			"editor.inactiveSelectionBackground": "#5469ff33",
			"editor.findMatchBackground": "#5469ff44",
			"editor.findMatchHighlightBackground": "#5469ff22",
			"editorWidget.background": "#1f2630",
			"editorWidget.border": "#2a313c",
			"editorIndentGuide.background1": "#2a313c",
			"editorIndentGuide.activeBackground1": "#3a4250",
			"scrollbarSlider.background": "#2a313c80",
			"scrollbarSlider.hoverBackground": "#3a4250cc",
			"scrollbarSlider.activeBackground": "#5469ffaa",
			"editorGutter.background": "#161b22",
			"editorBracketMatch.background": "#5469ff33",
			"editorBracketMatch.border": "#5469ff",
			"editorOverviewRuler.border": "#161b22"
		}
	});
}

export function RawYamlTab({
	value,
	onChange,
	originalValue,
	parse,
	guildId,
	testEmbedEnabled,
	onStatus,
	onEditorReady
}: Props): JSX.Element {
	const [tab, setTab] = useState<Tab>("edit");
	const isDirty = value !== originalValue;
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
	const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
	const [mounted, setMounted] = useState(false);

	// Stable ref so the Monaco command always calls the latest onStatus.
	const onStatusRef = useRef(onStatus);
	useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

	const onMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
		ensureTheme(monaco);
		monaco.editor.setTheme(THEME_NAME);
		setMounted(true);
	};

	// Push the editor up via effect so StrictMode's double-mount (and HMR)
	// re-publishes a live instance instead of a disposed one.
	useEffect(() => {
		if (!mounted) return;
		const editor = editorRef.current;
		if (!editor || !onEditorReady) return;
		onEditorReady(editor);
	}, [mounted, onEditorReady]);

	// Zod errors lack source locations; pin them all at line 1 and let
	// the Validation panel show the JSON path.
	useEffect(() => {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;
		const model = editor.getModel();
		if (!model) return;

		if (!parse || parse.ok) {
			monaco.editor.setModelMarkers(model, "azalea", []);
			return;
		}

		monaco.editor.setModelMarkers(
			model,
			"azalea",
			parse.errors.map(err => ({
				severity: monaco.MarkerSeverity.Error,
				message: err.path ? `${err.path}: ${err.message}` : err.message,
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 1,
				endColumn: 1
			}))
		);
	}, [parse]);

	// CodeLens above each embed-shaped YAML map. Clicking re-parses,
	// resolves anchors/aliases, and posts to TEST_WEBHOOK_URL.
	useEffect(() => {
		if (!mounted || !testEmbedEnabled) return;
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;

		const sendEmbed = async (path: JsPath, line: number): Promise<void> => {
			const text = editor.getModel()?.getValue() ?? "";
			let resolvedYaml: string;
			try {
				resolvedYaml = extractEmbedAtPath(text, path);
			} catch (err) {
				onStatusRef.current({
					tone: "err",
					message: `Couldn't re-extract embed at line ${line}: ${err instanceof Error ? err.message : String(err)}`
				});
				return;
			}

			onStatusRef.current({ tone: "info", message: `Sending test embed from line ${line}…` });
			const res = await api<{ ok: boolean; error?: string }>(
				`/api/guilds/${guildId}/config/test-webhook`,
				{ method: "POST", body: JSON.stringify({ yaml: resolvedYaml }) }
			);

			if (res.ok && res.body.ok) {
				onStatusRef.current({ tone: "ok", message: `Test embed sent (line ${line}, mentions disabled)` });
				return;
			}
			onStatusRef.current({
				tone: "err",
				message: `Test send failed: ${res.body.error ?? `HTTP ${res.status}`}`
			});
		};

		const cmdId = editor.addCommand(
			0,
			(_ctx, payload: { path: JsPath; line: number }) => {
				void sendEmbed(payload.path, payload.line);
			},
			""
		);
		if (!cmdId) return;

		type Lens = Parameters<Parameters<typeof monaco.languages.registerCodeLensProvider>[1]["resolveCodeLens"] & object>[1];
		const provider = monaco.languages.registerCodeLensProvider("yaml", {
			provideCodeLenses: model => {
				const lenses: Lens[] = [];
				let nextId = 0;
				for (const hit of findEmbedNodes(model.getValue())) {
					const line = model.getPositionAt(hit.offset).lineNumber;
					lenses.push({
						range: new monaco.Range(line, 1, line, 1),
						id: `azalea-test-embed-${nextId++}`,
						command: {
							id: cmdId,
							title: "$(beaker) Send test message",
							arguments: [{ path: hit.path, line }]
						}
					});
				}
				return { lenses, dispose: () => undefined };
			},
			resolveCodeLens: (_model, lens) => lens
		});

		return () => provider.dispose();
	}, [mounted, testEmbedEnabled, guildId]);

	const onDiffMount: DiffOnMount = (_editor, monaco) => {
		ensureTheme(monaco);
		monaco.editor.setTheme(THEME_NAME);
	};

	return (
		<div className="bg-bg-2 border border-border rounded-md overflow-hidden h-full flex flex-col">
			<div className="flex border-b border-border bg-bg-3 shrink-0">
				<TabButton active={tab === "edit"} onClick={() => setTab("edit")}>
					Edit
				</TabButton>
				<TabButton active={tab === "diff"} onClick={() => setTab("diff")}>
					Diff
					{isDirty && (
						<span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-warn align-middle" />
					)}
				</TabButton>
			</div>
			<div className="flex-1 min-h-0">
				{tab === "edit" ? (
					<Editor
						height="100%"
						language="yaml"
						theme={THEME_NAME}
						value={value}
						onChange={v => onChange(v ?? "")}
						onMount={onMount}
						options={{
							tabSize: 2,
							insertSpaces: false,
							minimap: { enabled: false },
							scrollBeyondLastLine: false,
							fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
							fontSize: 13,
							automaticLayout: true,
							padding: { top: 12, bottom: 12 },
							codeLens: true
						}}
					/>
				) : isDirty ? (
					<DiffEditor
						height="100%"
						language="yaml"
						theme={THEME_NAME}
						original={originalValue}
						modified={value}
						onMount={onDiffMount}
						options={{
							readOnly: true,
							renderSideBySide: false,
							minimap: { enabled: false },
							scrollBeyondLastLine: false,
							fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
							fontSize: 13,
							automaticLayout: true,
							padding: { top: 12, bottom: 12 },
							hideUnchangedRegions: {
								enabled: true,
								contextLineCount: 3,
								minimumLineCount: 3,
								revealLineCount: 20
							},
							renderOverviewRuler: false,
							diffWordWrap: "off"
						}}
					/>
				) : (
					<div className="h-full flex items-center justify-center text-xs text-muted px-6 text-center">
						No changes — the live config matches what's on disk.
					</div>
				)}
			</div>
		</div>
	);
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				"px-4 py-2 text-xs font-medium border-b-2 -mb-px cursor-pointer transition-colors " +
				(active
					? "border-accent text-fg"
					: "border-transparent text-muted hover:text-fg")
			}
		>
			{children}
		</button>
	);
}

type JsPath = (string | number)[];

const EMBED_KEYS = new Set([
	"title", "description", "url", "color",
	"footer", "author", "fields", "image", "thumbnail"
]);

// "strong" keys filter out maps that happen to share a single ambiguous
// key like `url` (e.g., embed authors).
const STRONG_EMBED_KEYS = new Set([
	"title", "description", "color",
	"footer", "author", "fields", "image", "thumbnail"
]);

function looksLikeEmbed(node: YAML.YAMLMap): boolean {
	if (node.items.length === 0) return false;
	let strong = 0;
	for (const pair of node.items) {
		const key = pair.key;
		const keyName = YAML.isScalar(key) ? String(key.value) : null;
		if (keyName === null) return false;
		if (!EMBED_KEYS.has(keyName)) return false;
		if (STRONG_EMBED_KEYS.has(keyName)) strong++;
	}
	return strong >= 1;
}

interface EmbedHit {
	offset: number;
	path: JsPath;
}

// Track JS path to each hit so the click handler can re-resolve after
// anchor/alias expansion.
function findEmbedNodes(text: string): EmbedHit[] {
	let doc: YAML.Document.Parsed;
	try {
		doc = YAML.parseDocument(text);
	} catch {
		return [];
	}
	if (!doc.contents) return [];

	const hits: EmbedHit[] = [];
	walk(doc.contents, [], hits);
	return hits;
}

function walk(node: unknown, path: JsPath, hits: EmbedHit[]): void {
	if (YAML.isMap(node)) {
		if (looksLikeEmbed(node) && node.range) {
			hits.push({ offset: node.range[0], path: [...path] });
		}
		for (const pair of node.items) {
			const key = pair.key;
			const keyName = YAML.isScalar(key) ? String(key.value) : null;
			if (keyName === null) continue;
			walk(pair.value, [...path, keyName], hits);
		}
		return;
	}
	if (YAML.isSeq(node)) {
		node.items.forEach((item, idx) => walk(item, [...path, idx], hits));
	}
}

// `doc.toJS()` expands aliases like `*colors.blue` before we walk the
// path and re-serialize for sending.
function extractEmbedAtPath(text: string, path: JsPath): string {
	const doc = YAML.parseDocument(text);
	const resolved = doc.toJS({ maxAliasCount: 1000 }) as unknown;

	let cursor: unknown = resolved;
	for (const segment of path) {
		if (cursor === null || cursor === undefined) {
			throw new Error(`path segment "${segment}" missing`);
		}
		if (typeof segment === "number") {
			if (!Array.isArray(cursor)) throw new Error(`expected array at "${segment}"`);
			cursor = cursor[segment];
		} else {
			if (typeof cursor !== "object" || Array.isArray(cursor)) {
				throw new Error(`expected object at "${segment}"`);
			}
			cursor = (cursor as Record<string, unknown>)[segment];
		}
	}

	if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
		throw new Error("resolved value is not an embed object");
	}
	return YAML.stringify(cursor);
}

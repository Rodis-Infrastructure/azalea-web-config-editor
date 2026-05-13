import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as YAML from "yaml";
import { api, type ValidationResult } from "../../lib/api";
import type { SaveStatus } from "./index";

interface Props {
	value: string;
	onChange: (next: string) => void;
	parse: ValidationResult | null;
	guildId: string;
	testEmbedEnabled: boolean;
	onStatus: (status: SaveStatus) => void;
}

const THEME_NAME = "azalea-dark";

/**
 * Custom Monaco theme matching the editor's design tokens (see
 * ui/src/styles.css `@theme`). Registered once on first editor mount;
 * subsequent mounts reuse it.
 */
function ensureTheme(monaco: Parameters<OnMount>[1]): void {
	monaco.editor.defineTheme(THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			// Tone the YAML rule colours toward the design palette.
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
	parse,
	guildId,
	testEmbedEnabled,
	onStatus
}: Props): JSX.Element {
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
	const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
	const [mounted, setMounted] = useState(false);

	// Keep a stable callback ref so the Monaco command — registered once per
	// guild — always invokes the latest handler.
	const onStatusRef = useRef(onStatus);
	useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

	const onMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
		ensureTheme(monaco);
		monaco.editor.setTheme(THEME_NAME);
		setMounted(true);
	};

	// Register Zod errors as Monaco markers. Without per-line locations from
	// the schema, surface them all at line 1 and rely on the Validation
	// panel for the JSON path.
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

	// CodeLens above each embed-shaped YAML map: "✉ Send test message".
	// Clicking re-parses the buffer, resolves anchors/aliases, and POSTs the
	// expanded embed through the editor's TEST_WEBHOOK_URL.
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
							title: "✉  Send test message",
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

	// `h-full` flows from the parent grid cell which is sized via the page's
	// flex chain. Monaco's automaticLayout watches the container and resizes
	// accordingly, so the editor truly fills the available space rather than
	// guessing a viewport-based height.
	return (
		<div className="bg-bg-2 border border-border rounded-md overflow-hidden h-full">
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
		</div>
	);
}

type JsPath = (string | number)[];

const EMBED_KEYS = new Set([
	"title", "description", "url", "color",
	"footer", "author", "fields", "image", "thumbnail"
]);

// Keys that strongly imply "this object is meant to be a Discord embed" — used
// to filter out unrelated maps that happen to share a single key like `url`.
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

/**
 * Walk the YAML document and find every map whose shape matches the embed
 * schema. We track the JS path (sequence of keys/indices) to each hit so
 * the click handler can re-resolve it after anchor expansion.
 */
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

/**
 * Re-parse the buffer, navigate `path` through the resolved JS tree (so
 * `*colors.blue` style aliases are expanded), and serialize the result
 * back to YAML for sending.
 */
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

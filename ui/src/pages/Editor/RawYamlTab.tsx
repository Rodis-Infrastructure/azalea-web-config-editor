import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { ValidationResult } from "../../lib/api";

interface Props {
	value: string;
	onChange: (next: string) => void;
	parse: ValidationResult | null;
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

export function RawYamlTab({ value, onChange, parse }: Props): JSX.Element {
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
	const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

	const onMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
		ensureTheme(monaco);
		monaco.editor.setTheme(THEME_NAME);
	};

	// Render Zod errors as Monaco markers. Without per-line locations from
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
					padding: { top: 12, bottom: 12 }
				}}
			/>
		</div>
	);
}

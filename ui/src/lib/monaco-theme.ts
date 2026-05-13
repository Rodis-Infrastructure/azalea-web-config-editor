import type { Monaco } from "@monaco-editor/react";

export const THEME_NAME = "azalea-dark";

// Mirrors the design tokens in styles.css. Calling `defineTheme` is
// idempotent — Monaco overwrites by name — so it's safe for every
// editor instance to call this on mount.
export function ensureTheme(monaco: Monaco): void {
	monaco.editor.defineTheme(THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "8a93a1", fontStyle: "italic" },
			{ token: "string", foreground: "f4dbb5" },
			{ token: "string.yaml", foreground: "f4dbb5" },
			{ token: "string.value.json", foreground: "f4dbb5" },
			{ token: "string.key.json", foreground: "8aa9ff" },
			{ token: "number", foreground: "f0a020" },
			{ token: "keyword.json", foreground: "5469ff" },
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

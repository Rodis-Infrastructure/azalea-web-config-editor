// Self-host Monaco. `editor.api` alone is just the surface API; the
// `editor.all` import wires up the controllers Monaco needs at runtime
// (CodeLens, hover, find, suggestions, etc.) — without it,
// `registerCodeLensProvider` registers a provider with nothing to
// consume it and the lens never renders. We still skip Monaco's
// ~30 bundled languages, only registering YAML.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

interface MonacoEnvironment {
	getWorker: (workerId: string, label: string) => Worker;
}

(globalThis as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
	getWorker() {
		return new editorWorker();
	}
};

loader.config({ monaco });

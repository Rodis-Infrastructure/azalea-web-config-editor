// Self-host Monaco so `@monaco-editor/react` doesn't fetch from
// cdn.jsdelivr.net at runtime. Importing the full `monaco-editor`
// package pulls in every Monarch language (~30 of them, ~3 MB
// post-minify). We use one language — YAML — so we import the core
// editor API and only the YAML basic-language contribution.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
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

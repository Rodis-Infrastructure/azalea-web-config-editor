// Self-host Monaco so `@monaco-editor/react` doesn't fetch from
// cdn.jsdelivr.net at runtime. Eliminates a CDN trust dependency and
// keeps the editor working under a strict CSP.
import * as monaco from "monaco-editor";
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

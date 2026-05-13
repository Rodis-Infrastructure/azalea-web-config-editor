import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 7477);
const FRONTEND_PORT = Number(process.env.EDITOR_PORT ?? 7476);

// Vite serves the user-facing port in dev. Anything other than the React
// app's own static assets gets proxied to Hono on BACKEND_PORT.
const proxyTarget = `http://127.0.0.1:${BACKEND_PORT}`;

export default defineConfig({
	root: "ui",
	publicDir: false,
	resolve: {
		alias: {
			"@": resolve(__dirname, "ui/src"),
			"@bot": resolve(__dirname, "../azalea/src"),
			"@utils": resolve(__dirname, "../azalea/src/utils"),
			"@managers": resolve(__dirname, "../azalea/src/managers")
		}
	},
	plugins: [react(), tailwindcss()],
	server: {
		host: "127.0.0.1",
		port: FRONTEND_PORT,
		strictPort: true,
		proxy: {
			"/api": proxyTarget,
			"/auth": proxyTarget,
			"/healthz": proxyTarget
		}
	},
	build: {
		outDir: "../ui/dist",
		emptyOutDir: true,
		// Sourcemaps add ~14 MB to the build and roughly triple peak
		// memory usage during Rollup's chunk emit — enough to OOM a
		// 1 GB deploy host. Disable in production; dev still has full
		// maps via Vite's dev server.
		sourcemap: false
	}
});

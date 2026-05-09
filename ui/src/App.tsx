import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type Me } from "./lib/api";
import { Login } from "./pages/Login";
import { GuildPicker } from "./pages/GuildPicker";
import { EditorPage } from "./pages/Editor";

type AuthState =
	| { kind: "loading" }
	| { kind: "unauthenticated" }
	| { kind: "authenticated"; me: Me };

export function App(): JSX.Element {
	const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

	useEffect(() => {
		void (async () => {
			const res = await api<Me>("/api/me");
			if (res.ok) setAuth({ kind: "authenticated", me: res.body });
			else setAuth({ kind: "unauthenticated" });
		})();
	}, []);

	if (auth.kind === "loading") {
		return <FullScreen>Loading…</FullScreen>;
	}
	if (auth.kind === "unauthenticated") {
		return <Login />;
	}

	return (
		<div className="h-full flex flex-col">
			<Header me={auth.me} onLogout={() => setAuth({ kind: "unauthenticated" })} />
			<main className="flex-1 min-h-0 max-w-[1400px] w-full mx-auto px-6 py-6 flex flex-col">
				<Routes>
					<Route path="/" element={<GuildPicker me={auth.me} />} />
					<Route path="/g/:guildId" element={<EditorPage me={auth.me} />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</main>
		</div>
	);
}

function Header({ me, onLogout }: { me: Me; onLogout: () => void }): JSX.Element {
	const navigate = useNavigate();
	const handleLogout = async (): Promise<void> => {
		await api("/auth/logout", { method: "POST" });
		onLogout();
		navigate("/");
	};
	return (
		<header className="h-13 px-6 flex items-center justify-between border-b border-border bg-bg-2">
			<button
				type="button"
				className="font-semibold tracking-tight cursor-pointer hover:text-accent"
				onClick={() => navigate("/")}
			>
				azalea-editor
			</button>
			<div className="flex items-center gap-3 text-muted text-sm">
				<span>{me.username}</span>
				<button
					type="button"
					className="hover:text-fg cursor-pointer"
					onClick={handleLogout}
				>
					Sign out
				</button>
			</div>
		</header>
	);
}

function FullScreen({ children }: { children: React.ReactNode }): JSX.Element {
	return (
		<div className="min-h-full flex items-center justify-center text-muted">
			{children}
		</div>
	);
}

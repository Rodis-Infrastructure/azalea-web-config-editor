import { useEffect, useRef, useState } from "react";
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
	return (
		<header className="h-13 px-6 flex items-center justify-between border-b border-border bg-bg-2">
			<button
				type="button"
				className="font-semibold tracking-tight cursor-pointer hover:text-accent"
				onClick={() => navigate("/")}
			>
				azalea-editor
			</button>
			<UserMenu me={me} onLogout={onLogout} />
		</header>
	);
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }): JSX.Element {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent): void => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const handleLogout = async (): Promise<void> => {
		setOpen(false);
		await api("/auth/logout", { method: "POST" });
		onLogout();
		navigate("/");
	};

	const initial = (me.username[0] ?? "?").toUpperCase();

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				className={
					"flex items-center gap-2 text-sm rounded-full pl-1 pr-3 py-1 border border-transparent cursor-pointer " +
					(open ? "bg-bg-3 border-border" : "hover:bg-bg-3 hover:border-border")
				}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<span
					className="w-7 h-7 rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center"
					aria-hidden
				>
					{initial}
				</span>
				<span className="text-fg max-w-[160px] truncate">{me.username}</span>
				<svg width="10" height="10" viewBox="0 0 10 10" className="text-muted shrink-0">
					<path d="M1 3.5L5 7L9 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
			{open && (
				<div
					role="menu"
					className="absolute right-0 top-[calc(100%+6px)] min-w-[200px] bg-bg-2 border border-border rounded-md shadow-lg py-1 z-50"
				>
					<div className="px-3 py-2 border-b border-border">
						<div className="text-fg text-sm truncate">{me.username}</div>
						<div className="text-muted text-[10px] mono truncate">{me.userId}</div>
					</div>
					<button
						type="button"
						role="menuitem"
						onClick={handleLogout}
						className="w-full text-left px-3 py-2 text-sm text-fg hover:bg-bg-3 cursor-pointer"
					>
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}

function FullScreen({ children }: { children: React.ReactNode }): JSX.Element {
	return (
		<div className="min-h-full flex items-center justify-center text-muted">
			{children}
		</div>
	);
}

export function Login(): JSX.Element {
	return (
		<div className="min-h-full flex items-center justify-center">
			<div className="bg-bg-2 border border-border rounded-lg p-8 max-w-md text-center">
				<h1 className="text-xl font-semibold mb-2">Sign in</h1>
				<p className="text-muted mb-6">
					Authenticate with Discord to edit guild configs.
				</p>
				<a
					href="/auth/login"
					className="inline-block bg-accent hover:bg-accent-hover text-white font-medium px-6 py-2 rounded transition-colors"
				>
					Sign in with Discord
				</a>
			</div>
		</div>
	);
}

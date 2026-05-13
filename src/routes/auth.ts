/**
 * Discord OAuth flow:
 *   GET /auth/login    → 302 to Discord authorize, sets a short-lived
 *                        signed `oauth_state` cookie for CSRF.
 *   GET /auth/callback → verifies state, exchanges code, creates session.
 *   POST /auth/logout  → destroys the session.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	buildAuthorizeUrl,
	exchangeCode,
	fetchOAuthUser,
	generateState
} from "@lib/auth";
import { createSession, destroySession, signCookieValue, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@lib/session";
import { sessionMiddleware, type SessionEnv } from "@/middleware/session";
import { env } from "@lib/env";

const STATE_COOKIE = "azalea_editor_oauth_state";
const STATE_TTL_SECONDS = 5 * 60;

export const authRoutes = new Hono<SessionEnv>().use("*", sessionMiddleware);

authRoutes.get("/login", c => {
	const state = generateState();
	setCookie(c, STATE_COOKIE, state, {
		httpOnly: true,
		secure: env.cookieSecure,
		sameSite: "Lax",
		path: "/",
		maxAge: STATE_TTL_SECONDS
	});
	return c.redirect(buildAuthorizeUrl(state));
});

authRoutes.get("/callback", async c => {
	const code = c.req.query("code");
	const stateParam = c.req.query("state");
	const stateCookie = getCookie(c, STATE_COOKIE);

	// Discord-side errors (?error=access_denied, ?error=consent_required,
	// etc.) come back without a `code`. Surface those distinctly so an
	// operator who cancelled the prompt isn't told their request was a
	// CSRF attempt.
	const discordError = c.req.query("error");
	if (discordError) {
		deleteCookie(c, STATE_COOKIE, { path: "/" });
		const description = c.req.query("error_description") ?? discordError;
		return c.json({ error: "discord_error", detail: description }, 400);
	}

	if (!code || !stateParam || !stateCookie || stateParam !== stateCookie) {
		return c.json({ error: "invalid_state" }, 400);
	}
	deleteCookie(c, STATE_COOKIE, { path: "/" });

	const tokens = await exchangeCode(code);
	const user = await fetchOAuthUser(tokens.access_token);

	const session = createSession(user.id, user.username);
	setCookie(c, SESSION_COOKIE_NAME, signCookieValue(session.id), {
		httpOnly: true,
		secure: env.cookieSecure,
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_TTL_SECONDS
	});

	return c.redirect("/");
});

authRoutes.post("/logout", c => {
	const session = c.get("session");
	if (session) destroySession(session.id);
	deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
	return c.json({ ok: true });
});

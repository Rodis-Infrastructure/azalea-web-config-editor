/**
 * Hono middleware that reads the session cookie, verifies its signature,
 * loads the corresponding session row, and attaches it to the context.
 * Routes that require auth read `c.get("session")`; routes that don't
 * (e.g. the OAuth callback) read it but don't fail when absent.
 */
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import {
	loadSession,
	SESSION_COOKIE_NAME,
	verifyCookieValue,
	type Session
} from "@lib/session";

export interface SessionEnv {
	Variables: {
		session: Session | null;
	};
}

export const sessionMiddleware = createMiddleware<SessionEnv>(async (c, next) => {
	const cookieValue = getCookie(c, SESSION_COOKIE_NAME);

	if (!cookieValue) {
		c.set("session", null);
		return next();
	}

	const sessionId = verifyCookieValue(cookieValue);
	if (!sessionId) {
		c.set("session", null);
		return next();
	}

	c.set("session", loadSession(sessionId));
	return next();
});

export const requireSession = createMiddleware<SessionEnv>(async (c, next) => {
	const session = c.get("session");
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}
	return next();
});

import { nanoid } from "nanoid";
import { createController } from "remix/router";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";

import { db } from "#db/connection.server";
import { sessions, users, type User } from "#db";
import { getSessionCookie } from "#lib/auth.server";
import {
  exchangeCode,
  fetchUserinfo,
  FOURM_AUTHORIZE_URL,
  FOURM_CLIENT_ID,
  FOURM_REDIRECT_URI,
  generateCodeChallenge,
  generateCodeVerifier,
  getCliRedirectUri,
} from "#lib/oauth.server";

import { routes } from "../../routes.ts";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export default createController(routes.auth, {
  actions: {
    fourm() {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const state = crypto.randomUUID();
      const params = new URLSearchParams({
        response_type: "code",
        client_id: FOURM_CLIENT_ID,
        redirect_uri: FOURM_REDIRECT_URI,
        scope: "openid profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      const cookie = oauthCookie(
        "artbin_oauth",
        JSON.stringify({ verifier, state }),
        SESSION_MAX_AGE > 600 ? 600 : SESSION_MAX_AGE,
      );
      return redirectWithHeaders(`${FOURM_AUTHORIZE_URL}?${params}`, { "Set-Cookie": cookie });
    },

    async fourmCallback(context) {
      const log = createRequestLogger();
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      const error = context.url.searchParams.get("error");

      if (error) return loginError(error);
      if (!code || !state) return loginError("missing_code");

      const oauthData = readOauthCookie<{ verifier: string; state: string }>(
        context.request,
        "artbin_oauth",
      );
      if (!oauthData) return loginError("missing_oauth_state");
      if (oauthData.state !== state) return loginError("state_mismatch");

      try {
        const tokenData = await exchangeCode(code, oauthData.verifier);
        const userinfo = await fetchUserinfo(tokenData.access_token);
        const user = await upsertUser(userinfo);
        const sessionId = await createSession(user.id);

        log.set({
          auth: { userId: user.id, username: user.username, fourmId: userinfo.sub },
        });
        log.emit();

        const headers = new Headers();
        headers.append("Set-Cookie", clearOauthCookie("artbin_oauth"));
        headers.append("Set-Cookie", getSessionCookie(sessionId));
        return redirectWithHeaders(routes.folders.href(), headers);
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "oauth-callback",
        });
        log.emit();
        return loginError("oauth_failed");
      }
    },

    cliAuthorize(context) {
      const cliPort = parseCliPort(context.url.searchParams.get("port"));
      if (!cliPort) return new Response("Invalid or missing port parameter", { status: 400 });

      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const state = crypto.randomUUID();
      const params = new URLSearchParams({
        response_type: "code",
        client_id: FOURM_CLIENT_ID,
        redirect_uri: getCliRedirectUri(),
        scope: "openid profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      const cookie = oauthCookie(
        "artbin_cli_oauth",
        JSON.stringify({ verifier, state, cliPort }),
        600,
      );
      return redirectWithHeaders(`${FOURM_AUTHORIZE_URL}?${params}`, { "Set-Cookie": cookie });
    },

    async cliCallback(context) {
      const log = createRequestLogger();
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      const error = context.url.searchParams.get("error");
      if (error) return new Response(`OAuth error: ${error}`, { status: 400 });
      if (!code || !state) return new Response("Missing code or state", { status: 400 });

      const oauthData = readOauthCookie<{
        verifier: string;
        state: string;
        cliPort: number;
      }>(context.request, "artbin_cli_oauth");
      if (!oauthData || !parseCliPort(String(oauthData.cliPort))) {
        return new Response("Missing or invalid OAuth state", { status: 400 });
      }
      if (oauthData.state !== state) return new Response("State mismatch", { status: 400 });

      try {
        const tokenData = await exchangeCode(code, oauthData.verifier, getCliRedirectUri());
        const userinfo = await fetchUserinfo(tokenData.access_token);
        const user = await upsertUser(userinfo);
        const sessionId = await createSession(user.id);

        log.set({
          auth: {
            channel: "cli",
            userId: user.id,
            username: user.username,
            fourmId: userinfo.sub,
          },
        });
        log.emit();

        return redirectWithHeaders(
          `http://localhost:${oauthData.cliPort}/callback?session=${encodeURIComponent(sessionId)}`,
          { "Set-Cookie": clearOauthCookie("artbin_cli_oauth") },
        );
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "oauth-callback",
          channel: "cli",
        });
        log.emit();
        return new Response("OAuth callback failed", { status: 500 });
      }
    },
  },
});

async function upsertUser(userinfo: {
  sub: string;
  username: string;
  is_admin: boolean;
}): Promise<User> {
  let user = await db.query.users.findFirst({ where: eq(users.fourmId, userinfo.sub) });

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        id: nanoid(),
        username: userinfo.username,
        fourmId: userinfo.sub,
        isAdmin: userinfo.is_admin,
      })
      .returning();
    if (!created) throw new Error("Failed to create the local user");
    return created;
  }

  if (user.username !== userinfo.username || user.isAdmin !== userinfo.is_admin) {
    const [updated] = await db
      .update(users)
      .set({ username: userinfo.username, isAdmin: userinfo.is_admin })
      .where(eq(users.id, user.id))
      .returning();
    if (updated) user = updated;
  }

  return user;
}

async function createSession(userId: string): Promise<string> {
  const sessionId = nanoid(32);
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1_000),
  });
  return sessionId;
}

function oauthCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearOauthCookie(name: string): string {
  return oauthCookie(name, "", 0);
}

function readOauthCookie<value>(request: Request, name: string): value | null {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]!)) as value;
  } catch {
    return null;
  }
}

function redirectWithHeaders(href: string, headersInit?: HeadersInit, status = 302): Response {
  const headers = new Headers(headersInit);
  headers.set("Location", href);
  return new Response(null, { status, headers });
}

function loginError(code: string): Response {
  return redirectWithHeaders(`${routes.login.href()}?error=${encodeURIComponent(code)}`);
}

function parseCliPort(value: string | null): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

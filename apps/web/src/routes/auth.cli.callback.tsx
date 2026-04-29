import { redirect } from "react-router";
import type { Route } from "./+types/auth.cli.callback";
import { exchangeCode, fetchUserinfo, getCliRedirectUri } from "~/lib/oauth.server";
import { db } from "~/db/connection.server";
import { users, sessions } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const oauthMatch = cookieHeader.match(/artbin_cli_oauth=([^;]+)/);
  if (!oauthMatch) {
    return new Response("Missing OAuth state cookie", { status: 400 });
  }

  let oauthData: { verifier: string; state: string; cliPort: string };
  try {
    oauthData = JSON.parse(decodeURIComponent(oauthMatch[1]));
  } catch {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  if (oauthData.state !== state) {
    return new Response("State mismatch", { status: 400 });
  }

  let tokenData;
  try {
    tokenData = await exchangeCode(code, oauthData.verifier, getCliRedirectUri());
  } catch (err) {
    return new Response(`Token exchange failed: ${err}`, { status: 500 });
  }

  let userinfo;
  try {
    userinfo = await fetchUserinfo(tokenData.access_token);
  } catch (err) {
    return new Response(`Userinfo fetch failed: ${err}`, { status: 500 });
  }

  // Find or create user (same logic as web callback)
  let localUser = await db.query.users.findFirst({
    where: eq(users.fourmId, userinfo.sub),
  });

  if (!localUser) {
    const userId = nanoid();
    const [created] = await db
      .insert(users)
      .values({
        id: userId,
        email: `${userinfo.username}@4orm.local`,
        username: userinfo.username,
        fourmId: userinfo.sub,
        isAdmin: userinfo.is_admin,
      })
      .returning();
    localUser = created;
  } else {
    const updates: Partial<{ username: string; isAdmin: boolean }> = {};
    if (localUser.username !== userinfo.username) updates.username = userinfo.username;
    if (localUser.isAdmin !== userinfo.is_admin) updates.isAdmin = userinfo.is_admin;
    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, localUser.id));
    }
  }

  if (!localUser.isAdmin && !userinfo.is_admin) {
    return new Response("CLI access requires admin privileges", { status: 403 });
  }

  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  await db.insert(sessions).values({
    id: sessionId,
    userId: localUser.id,
    expiresAt,
  });

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const clearCookie = `artbin_cli_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;

  return redirect(`http://localhost:${oauthData.cliPort}/callback?session=${sessionId}`, {
    headers: { "Set-Cookie": clearCookie },
  });
}

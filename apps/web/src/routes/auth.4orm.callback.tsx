import { redirect } from "react-router";
import type { Route } from "./+types/auth.4orm.callback";
import { exchangeCode, fetchUserinfo } from "~/lib/oauth.server";
import { db } from "~/db/connection.server";
import { users, sessions } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSessionCookie } from "~/lib/auth.server";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return redirect("/login?error=missing_code");
  }

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const oauthMatch = cookieHeader.match(/artbin_oauth=([^;]+)/);
  if (!oauthMatch) {
    return redirect("/login?error=missing_oauth_state");
  }

  let oauthData: { verifier: string; state: string };
  try {
    oauthData = JSON.parse(decodeURIComponent(oauthMatch[1]));
  } catch {
    return redirect("/login?error=invalid_oauth_state");
  }

  if (oauthData.state !== state) {
    return redirect("/login?error=state_mismatch");
  }

  let tokenData;
  try {
    tokenData = await exchangeCode(code, oauthData.verifier);
  } catch (err) {
    console.error("Token exchange failed:", err);
    return redirect("/login?error=token_exchange_failed");
  }

  let userinfo;
  try {
    userinfo = await fetchUserinfo(tokenData.access_token);
  } catch (err) {
    console.error("Userinfo fetch failed:", err);
    return redirect("/login?error=userinfo_failed");
  }

  // Find user by their 4orm ID (stable identifier)
  let localUser = await db.query.users.findFirst({
    where: eq(users.fourmId, userinfo.sub),
  });

  if (!localUser) {
    // First time logging in from 4orm -- create account
    const userId = nanoid();
    const [created] = await db
      .insert(users)
      .values({
        id: userId,
        email: `${userinfo.username}@4orm.local`,
        username: userinfo.username,
        passwordHash: "",
        fourmId: userinfo.sub,
        isAdmin: userinfo.is_admin,
      })
      .returning();
    localUser = created;
  } else {
    // Sync username and admin status from 4orm on each login
    const updates: Partial<{ username: string; isAdmin: boolean }> = {};
    if (localUser.username !== userinfo.username) {
      updates.username = userinfo.username;
    }
    if (localUser.isAdmin !== userinfo.is_admin) {
      updates.isAdmin = userinfo.is_admin;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, localUser.id));
    }
  }

  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  await db.insert(sessions).values({
    id: sessionId,
    userId: localUser.id,
    expiresAt,
  });

  const clearOauth = "artbin_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  const headers = new Headers();
  headers.append("Set-Cookie", clearOauth);
  headers.append("Set-Cookie", getSessionCookie(sessionId));

  return redirect("/folders", { headers });
}

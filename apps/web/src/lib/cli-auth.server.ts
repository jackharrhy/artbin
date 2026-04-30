import { parseSessionCookie, getUserFromSession } from "./auth.server";
import type { User } from "~/db";

/** Authenticate any user (admin or not). Throws 401 if not logged in. */
export async function requireCliAuth(request: Request): Promise<User> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (!user) {
    throw Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  return user;
}

/** Authenticate and require admin. Throws 401/403. */
export async function requireCliAdmin(request: Request): Promise<User> {
  const user = await requireCliAuth(request);
  if (!user.isAdmin) {
    throw Response.json({ error: "Admin access required" }, { status: 403 });
  }
  return user;
}

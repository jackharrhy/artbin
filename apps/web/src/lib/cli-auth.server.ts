import { parseSessionCookie, getUserFromSession } from "./auth.server";
import type { User } from "~/db";

export async function requireCliAdmin(request: Request): Promise<User> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);
  if (!user) {
    throw Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.isAdmin) {
    throw Response.json({ error: "Admin access required" }, { status: 403 });
  }
  return user;
}

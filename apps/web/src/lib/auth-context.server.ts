import { createContext, redirect } from "react-router";
import { parseSessionCookie, getUserFromSession } from "./auth.server";
import type { User } from "~/db";

export const userContext = createContext<User>();

export async function authMiddleware({ request, context }: { request: Request; context: any }) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    throw redirect("/login");
  }

  context.set(userContext, user);
}

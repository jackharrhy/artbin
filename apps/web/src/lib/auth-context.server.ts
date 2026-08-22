import { createContext, redirect } from "react-router";
import { getUserFromRequest } from "./auth.server";
import type { User } from "~/db";

export const userContext = createContext<User>();

export async function authMiddleware({ request, context }: { request: Request; context: any }) {
  const user = await getUserFromRequest(request);

  if (!user) {
    throw redirect("/login");
  }

  context.set(userContext, user);
}

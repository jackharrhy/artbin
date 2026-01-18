import { redirect } from "react-router";
import type { Route } from "./+types/dashboard";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";

// Dashboard now redirects to textures - settings handles profile/invites
export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  return redirect("/textures");
}

export default function Dashboard() {
  return null;
}

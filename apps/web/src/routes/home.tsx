import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  // If logged in, go straight to folders
  if (user) {
    return redirect("/folders");
  }

  return null;
}

export function meta() {
  return [{ title: "artbin" }, { name: "description", content: "Texture repository" }];
}

export default function Home() {
  return (
    <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border text-center">
      <h1 className="text-2xl mb-4">artbin</h1>
      <p className="mb-6 text-text-muted">Texture repository. Invite only.</p>
      <a href="/login" className="btn btn-primary">
        Login
      </a>
    </main>
  );
}

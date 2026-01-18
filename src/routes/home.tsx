import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { Header } from "~/components/Header";

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
  return [
    { title: "artbin" },
    { name: "description", content: "Texture repository" },
  ];
}

export default function Home() {
  return (
    <div>
      <Header />
      <main className="auth-container" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>artbin</h1>
        <p style={{ marginBottom: "1.5rem", color: "#666" }}>
          Texture repository. Invite only.
        </p>
        <a href="/login" className="btn btn-primary">
          Login
        </a>
      </main>
    </div>
  );
}

import { redirect, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/settings";
import {
  parseSessionCookie,
  getUserFromSession,
  getClearSessionCookie,
  logout,
} from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "logout") {
    if (sessionId) {
      await logout(sessionId);
    }
    return redirect("/", {
      headers: {
        "Set-Cookie": getClearSessionCookie(),
      },
    });
  }

  return null;
}

export function meta() {
  return [{ title: "Settings - artbin" }];
}

export default function Settings() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <main className="max-w-[600px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">Settings</h1>

      {/* Account Info */}
      <section className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
          Account
        </h2>
        <div className="card">
          <div className="mb-4">
            <span className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
              Username
            </span>
            <div>@{user.username}</div>
          </div>
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="btn btn-danger btn-sm">
              Logout
            </button>
          </Form>
        </div>
      </section>

      {/* Admin Section */}
      {user.isAdmin && (
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Admin
          </h2>
          <div className="card flex gap-2">
            <a href="/admin/jobs" className="btn btn-sm">
              View Jobs
            </a>
            <a href="/admin/import" className="btn btn-sm">
              Import Textures
            </a>
            <a href="/admin/users" className="btn btn-sm">
              Users
            </a>
          </div>
        </section>
      )}
    </main>
  );
}

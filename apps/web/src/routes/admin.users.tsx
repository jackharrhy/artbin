import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/admin.users";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db } from "~/db/connection.server";
import { users } from "~/db";
import { desc } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/");
  }

  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return { allUsers };
}

export function meta() {
  return [{ title: "Users - Admin - artbin" }];
}

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export default function AdminUsers() {
  const { allUsers } = useLoaderData<typeof loader>();

  return (
    <main className="max-w-[800px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-light">
        <h1 className="text-xl font-normal">Users ({allUsers.length})</h1>
      </div>

      {allUsers.length === 0 ? (
        <p className="text-text-muted">No users yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light text-left text-text-muted">
              <th className="pb-2 font-medium">Username</th>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {allUsers.map((u) => (
              <tr key={u.id} className="border-b border-border-light">
                <td className="py-2">@{u.username}</td>
                <td className="py-2 text-text-muted">{u.email}</td>
                <td className="py-2">
                  {u.isAdmin ? (
                    <span className="text-xs font-medium uppercase tracking-wide text-amber-500">
                      Admin
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">User</span>
                  )}
                </td>
                <td className="py-2 text-text-muted">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="mt-6 pt-4 border-t border-border-light flex gap-2">
        <a href="/admin/jobs" className="btn btn-sm">
          Jobs
        </a>
        <a href="/admin/import" className="btn btn-sm">
          Import
        </a>
        <a href="/settings" className="btn btn-sm">
          Settings
        </a>
      </footer>
    </main>
  );
}

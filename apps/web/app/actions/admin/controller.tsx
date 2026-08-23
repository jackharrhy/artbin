import { desc } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { users } from "#db";
import { db } from "#db/connection.server";

import { requireAdmin } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";
import { AdminPage } from "../../ui/admin-page.tsx";

export default createController(routes.admin, {
  middleware: [requireAdmin()],
  actions: {
    async users(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt));

      return context.render(
        <AdminPage user={context.user} active="users" title="Users">
          {allUsers.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-light text-left text-text-muted">
                  <th className="pb-2 font-medium">Username</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map((user) => (
                  <tr key={user.id} className="border-b border-border-light">
                    <td className="py-2">@{user.username}</td>
                    <td className="py-2">{user.isAdmin ? "Admin" : "User"}</td>
                    <td className="py-2 text-text-muted">
                      {user.createdAt ? new Date(user.createdAt).toLocaleString() : "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-text-muted">No users yet.</p>
          )}
        </AdminPage>,
      );
    },
  },
});

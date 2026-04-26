import { redirect, useLoaderData, useActionData, Form } from "react-router";
import type { Route } from "./+types/settings";
import {
  parseSessionCookie,
  getUserFromSession,
  createInviteCode,
  deleteInviteCode,
  toggleInviteCode,
  getClearSessionCookie,
} from "~/lib/auth.server";
import { db, inviteCodes } from "~/db";
import { eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const userInvites = await db.query.inviteCodes.findMany({
    where: eq(inviteCodes.createdBy, user.id),
    orderBy: [desc(inviteCodes.createdAt)],
  });

  // Get base URL for invite links
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return { user, invites: userInvites, baseUrl };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "createInvite") {
    const maxUsesStr = formData.get("maxUses") as string;
    const maxUses = maxUsesStr ? parseInt(maxUsesStr, 10) : undefined;
    await createInviteCode(user.id, maxUses);
    return { success: "Invite link created" };
  }

  if (intent === "deleteInvite") {
    const inviteId = formData.get("inviteId") as string;
    const deleted = await deleteInviteCode(user.id, inviteId);
    if (!deleted) {
      return { error: "Could not delete invite" };
    }
    return { success: "Invite deleted" };
  }

  if (intent === "toggleInvite") {
    const inviteId = formData.get("inviteId") as string;
    await toggleInviteCode(user.id, inviteId);
    return { success: "Invite updated" };
  }

  if (intent === "logout") {
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
  const { user, invites, baseUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="max-w-[600px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">Settings</h1>

        {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}
        {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}

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
            <div className="mb-4">
              <span className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
                Email
              </span>
              <div>{user.email}</div>
            </div>
            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" className="btn btn-danger btn-sm">
                Logout
              </button>
            </Form>
          </div>
        </section>

        {/* Invite Links */}
        <section className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted mb-3">
            Invite Links
          </h2>
          <p className="text-xs text-text-muted mt-1 mb-4">
            Share these links to invite others. Links can be used multiple times unless you set a
            limit.
          </p>

          <Form method="post" className="card mb-4">
            <input type="hidden" name="intent" value="createInvite" />
            <div className="mb-4">
              <label
                className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1"
                htmlFor="maxUses"
              >
                Usage Limit (optional)
              </label>
              <input
                type="number"
                id="maxUses"
                name="maxUses"
                min="1"
                placeholder="Leave empty for unlimited"
                className="input w-[200px]"
              />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              Create Invite Link
            </button>
          </Form>

          {invites.length === 0 ? (
            <div className="text-sm text-text-muted">No invite links yet</div>
          ) : (
            <div>
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-2 border border-border-light mb-2 bg-bg"
                >
                  <div>
                    <div className="font-mono text-sm">
                      {baseUrl}/invite/{invite.code}
                    </div>
                    <div className="text-xs text-text-muted">
                      {invite.useCount ?? 0} uses
                      {invite.maxUses ? ` / ${invite.maxUses} max` : " (unlimited)"}
                      {!invite.isActive && " - disabled"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(`${baseUrl}/invite/${invite.code}`);
                      }}
                    >
                      copy
                    </button>
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggleInvite" />
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <button type="submit" className="btn btn-sm">
                        {invite.isActive ? "disable" : "enable"}
                      </button>
                    </Form>
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="deleteInvite" />
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <button type="submit" className="btn btn-sm btn-danger">
                        delete
                      </button>
                    </Form>
                  </div>
                </div>
              ))}
            </div>
          )}
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
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

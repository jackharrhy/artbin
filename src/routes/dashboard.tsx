import { redirect, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/dashboard";
import { parseSessionCookie, getUserFromSession, createInviteCode, getClearSessionCookie } from "~/lib/auth.server";
import { db, inviteCodes } from "~/db";
import { eq, desc } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get user's invite codes
  const userInvites = await db.query.inviteCodes.findMany({
    where: eq(inviteCodes.createdBy, user.id),
    orderBy: [desc(inviteCodes.createdAt)],
  });

  return { user, invites: userInvites };
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
    await createInviteCode(user.id);
    return { success: true };
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
  return [{ title: "Dashboard - artbin" }];
}

export default function Dashboard() {
  const { user, invites } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-fuchsia p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            <a href="/dashboard">
              <span className="text-fuchsia">*</span>
              <span className="text-aqua">~</span>
              <span className="text-lime"> artbin </span>
              <span className="text-aqua">~</span>
              <span className="text-fuchsia">*</span>
            </a>
          </h1>
          <nav className="flex items-center gap-4">
            <span className="text-lime">@{user.username}</span>
            {user.isAdmin && <span className="tag tag-fire">ADMIN</span>}
            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" className="btn">Logout</button>
            </Form>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-lime">
            Welcome back, {user.username}!
          </h2>
          <hr className="hr-rainbow my-4" />
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <a href="/textures" className="box-retro hover:border-lime text-center">
            <h3 className="text-xl font-bold text-lime mb-2">Browse Textures</h3>
            <p className="text-sm">Explore the texture library</p>
          </a>
          <a href="/upload" className="box-retro hover:border-aqua text-center">
            <h3 className="text-xl font-bold text-aqua mb-2">Upload</h3>
            <p className="text-sm">Add new textures</p>
          </a>
          <a href="/moodboards" className="box-retro hover:border-yellow text-center">
            <h3 className="text-xl font-bold text-yellow mb-2">Moodboards</h3>
            <p className="text-sm">Create & view boards</p>
          </a>
        </div>

        {/* Invite Codes Section */}
        <div className="box-retro">
          <h3 className="text-xl font-bold text-fuchsia mb-4">
            :: Invite Friends ::
          </h3>
          <p className="text-sm mb-4">
            artbin is invite-only. Generate codes to invite your friends!
          </p>

          <Form method="post" className="mb-4">
            <input type="hidden" name="intent" value="createInvite" />
            <button type="submit" className="btn btn-primary">
              Generate Invite Code
            </button>
          </Form>

          {invites.length > 0 && (
            <div className="mt-4">
              <h4 className="text-lg font-bold text-aqua mb-2">Your Invite Codes:</h4>
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className={`p-2 border-2 ${invite.usedBy ? "border-gray text-gray" : "border-lime"}`}
                  >
                    <code className="font-mono text-lg">{invite.code}</code>
                    {invite.usedBy ? (
                      <span className="ml-2 text-sm">(used)</span>
                    ) : (
                      <span className="ml-2 text-sm text-lime">(available)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Admin Section */}
        {user.isAdmin && (
          <div className="box-warning mt-8">
            <h3 className="text-xl font-bold text-yellow mb-4">
              :: Admin Tools ::
            </h3>
            <div className="flex gap-4">
              <a href="/admin/users" className="btn">Manage Users</a>
              <a href="/admin/import" className="btn">Import Textures</a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/moodboards";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, moodboards, moodboardItems, users } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get user's moodboards
  const userMoodboards = await db
    .select({
      id: moodboards.id,
      name: moodboards.name,
      description: moodboards.description,
      createdAt: moodboards.createdAt,
      ownerUsername: users.username,
    })
    .from(moodboards)
    .leftJoin(users, eq(moodboards.ownerId, users.id))
    .where(eq(moodboards.ownerId, user.id))
    .orderBy(desc(moodboards.createdAt));

  return { user, moodboards: userMoodboards };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;

    if (!name) {
      return { error: "Name is required" };
    }

    const [board] = await db
      .insert(moodboards)
      .values({
        id: nanoid(),
        name,
        description: description || null,
        ownerId: user.id,
      })
      .returning();

    return redirect(`/moodboard/${board.id}`);
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;

    // Delete items first
    await db.delete(moodboardItems).where(eq(moodboardItems.moodboardId, id));
    // Delete moodboard
    await db.delete(moodboards).where(eq(moodboards.id, id));

    return { success: "Moodboard deleted" };
  }

  return null;
}

export function meta() {
  return [{ title: "Moodboards - artbin" }];
}

export default function Moodboards() {
  const { moodboards } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

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
            <a href="/textures" className="btn">Textures</a>
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-yellow mb-2">
          :: Moodboards ::
        </h2>
        <p className="text-center text-sm mb-4">
          Create boards to collect textures, images, and notes for your game's vibe
        </p>
        <hr className="hr-rainbow my-4" />

        {actionData?.error && (
          <div className="box-warning mb-4 text-center">
            {actionData.error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Create New */}
          <div className="box-retro">
            <h3 className="text-xl font-bold text-lime mb-4">Create New Moodboard</h3>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create" />

              <div>
                <label htmlFor="name" className="block text-aqua mb-1">
                  Name:
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  placeholder="My Game Vibes"
                  className="input-retro w-full"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-aqua mb-1">
                  Description:
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="What's this board about?"
                  className="input-retro w-full"
                />
              </div>

              <button type="submit" className="btn btn-success w-full">
                Create Board
              </button>
            </Form>
          </div>

          {/* Boards List */}
          <div className="box-retro">
            <h3 className="text-xl font-bold text-fuchsia mb-4">Your Moodboards</h3>
            
            {moodboards.length === 0 ? (
              <p className="text-gray text-center py-8">
                No moodboards yet. Create your first one!
              </p>
            ) : (
              <div className="space-y-3">
                {moodboards.map((board) => (
                  <div
                    key={board.id}
                    className="p-3 border-2 border-fuchsia hover:border-lime flex items-center justify-between"
                  >
                    <div>
                      <a
                        href={`/moodboard/${board.id}`}
                        className="text-lime font-bold hover:text-aqua"
                      >
                        {board.name}
                      </a>
                      {board.description && (
                        <p className="text-sm text-gray truncate">
                          {board.description}
                        </p>
                      )}
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={board.id} />
                      <button
                        type="submit"
                        className="text-red text-sm hover:underline"
                        onClick={(e) => {
                          if (!confirm("Delete this moodboard?")) {
                            e.preventDefault();
                          }
                        }}
                      >
                        delete
                      </button>
                    </Form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

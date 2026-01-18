import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/moodboards";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, moodboards, moodboardItems, users } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const userMoodboards = await db
    .select({
      id: moodboards.id,
      name: moodboards.name,
      description: moodboards.description,
      createdAt: moodboards.createdAt,
    })
    .from(moodboards)
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
    await db.delete(moodboardItems).where(eq(moodboardItems.moodboardId, id));
    await db.delete(moodboards).where(eq(moodboards.id, id));
    return { success: "Deleted" };
  }

  return null;
}

export function meta() {
  return [{ title: "Moodboards - artbin" }];
}

export default function Moodboards() {
  const { user, moodboards } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "600px" }}>
        <h1 className="page-title">Moodboards</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {/* Create form */}
        <Form method="post" className="card" style={{ marginBottom: "1.5rem" }}>
          <input type="hidden" name="intent" value="create" />
          <div className="form-group">
            <label htmlFor="name" className="form-label">Name</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              className="input"
              style={{ width: "100%" }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="description" className="form-label">Description</label>
            <input
              type="text"
              id="description"
              name="description"
              className="input"
              style={{ width: "100%" }}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">
            Create
          </button>
        </Form>

        {/* List */}
        {moodboards.length === 0 ? (
          <div className="empty-state">No moodboards yet</div>
        ) : (
          <div>
            {moodboards.map((board) => (
              <div key={board.id} className="invite-item">
                <div>
                  <a href={`/moodboard/${board.id}`} style={{ fontWeight: "500" }}>
                    {board.name}
                  </a>
                  {board.description && (
                    <div className="invite-meta">{board.description}</div>
                  )}
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={board.id} />
                  <button
                    type="submit"
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      if (!confirm("Delete?")) e.preventDefault();
                    }}
                  >
                    delete
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

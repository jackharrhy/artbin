import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/moodboard.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, moodboards, moodboardItems, files } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Header } from "~/components/Header";

interface TextContent { text: string; }
interface LinkContent { url: string; title?: string; }
interface ColorContent { color: string; }

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const board = await db.query.moodboards.findFirst({
    where: eq(moodboards.id, params.id!),
  });

  if (!board) {
    throw new Response("Not found", { status: 404 });
  }

  if (board.ownerId !== user.id) {
    throw new Response("Not authorized", { status: 403 });
  }

  const items = await db.query.moodboardItems.findMany({
    where: eq(moodboardItems.moodboardId, params.id!),
    orderBy: [desc(moodboardItems.createdAt)],
  });

  // Get user's uploaded texture files for the dropdown
  const userFiles = await db.query.files.findMany({
    where: eq(files.uploaderId, user.id),
    orderBy: [desc(files.createdAt)],
    limit: 50,
  });

  // Filter to only textures
  const userTextures = userFiles.filter(f => f.kind === "texture");

  return { user, board, items, userTextures };
}

export async function action({ request, params }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const board = await db.query.moodboards.findFirst({
    where: eq(moodboards.id, params.id!),
  });

  if (!board || board.ownerId !== user.id) {
    return redirect("/moodboards");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "addText") {
    const text = formData.get("text") as string;
    if (!text) return { error: "Text required" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "text",
      content: JSON.stringify({ text } as TextContent),
    });
    return { success: true };
  }

  if (intent === "addFile") {
    const fileId = formData.get("fileId") as string;
    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) return { error: "File not found" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "file",
      fileId: file.id,
      content: null,
    });
    return { success: true };
  }

  if (intent === "addLink") {
    const url = formData.get("url") as string;
    if (!url) return { error: "URL required" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "link",
      content: JSON.stringify({ url, title: formData.get("title") } as LinkContent),
    });
    return { success: true };
  }

  if (intent === "addColor") {
    const color = formData.get("color") as string;
    if (!color) return { error: "Color required" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "color",
      content: JSON.stringify({ color } as ColorContent),
    });
    return { success: true };
  }

  if (intent === "deleteItem") {
    const itemId = formData.get("itemId") as string;
    await db.delete(moodboardItems).where(eq(moodboardItems.id, itemId));
    return { success: true };
  }

  return null;
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.board?.name || "Moodboard"} - artbin` }];
}

export default function MoodboardView() {
  const { user, board, items, userTextures } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        <div className="breadcrumb">
          <a href="/moodboards">Moodboards</a>
          <span className="breadcrumb-sep">/</span>
          <span>{board.name}</span>
        </div>

        <h1 className="page-title">{board.name}</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "2rem" }}>
          {/* Add panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Text */}
            <Form method="post" className="card">
              <input type="hidden" name="intent" value="addText" />
              <div className="section-title">Add Text</div>
              <textarea name="text" rows={2} className="input" style={{ width: "100%", marginBottom: "0.5rem" }} required />
              <button type="submit" className="btn btn-sm">Add</button>
            </Form>

            {/* File/Texture */}
            {userTextures.length > 0 && (
              <Form method="post" className="card">
                <input type="hidden" name="intent" value="addFile" />
                <div className="section-title">Add Texture</div>
                <select name="fileId" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} required>
                  <option value="">Select...</option>
                  {userTextures.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button type="submit" className="btn btn-sm">Add</button>
              </Form>
            )}

            {/* Link */}
            <Form method="post" className="card">
              <input type="hidden" name="intent" value="addLink" />
              <div className="section-title">Add Link</div>
              <input type="url" name="url" placeholder="URL" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} required />
              <input type="text" name="title" placeholder="Title" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} />
              <button type="submit" className="btn btn-sm">Add</button>
            </Form>

            {/* Color */}
            <Form method="post" className="card">
              <input type="hidden" name="intent" value="addColor" />
              <div className="section-title">Add Color</div>
              <input type="color" name="color" className="input" style={{ width: "100%", height: "40px", marginBottom: "0.5rem" }} required />
              <button type="submit" className="btn btn-sm">Add</button>
            </Form>
          </div>

          {/* Board */}
          <div>
            {items.length === 0 ? (
              <div className="empty-state">Empty board - add items from the left panel</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.5rem" }}>
                {items.map((item) => {
                  const content = item.content ? JSON.parse(item.content) : null;
                  return (
                    <div key={item.id} className="card" style={{ position: "relative", padding: "0.5rem" }}>
                      {item.type === "text" && content && (
                        <p style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{content.text}</p>
                      )}
                      {item.type === "file" && item.fileId && (
                        <FilePreview fileId={item.fileId} />
                      )}
                      {item.type === "link" && content && (
                        <a href={content.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", wordBreak: "break-all" }}>
                          {content.title || content.url}
                        </a>
                      )}
                      {item.type === "color" && content && (
                        <div style={{ width: "100%", height: "80px", background: content.color, borderRadius: "4px" }} title={content.color} />
                      )}
                      <Form method="post" style={{ position: "absolute", top: "0.25rem", right: "0.25rem" }}>
                        <input type="hidden" name="intent" value="deleteItem" />
                        <input type="hidden" name="itemId" value={item.id} />
                        <button type="submit" className="btn btn-sm btn-danger" style={{ padding: "0 0.25rem", fontSize: "0.625rem" }}>x</button>
                      </Form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// Simple component to render file preview - would need to be enhanced for real use
function FilePreview({ fileId }: { fileId: string }) {
  // In a real app, we'd fetch the file info or pass it down
  // For now, just show a placeholder that links to the file
  return (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <a href={`/file/${fileId}`}>View File</a>
    </div>
  );
}

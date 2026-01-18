import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/moodboard.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, moodboards, moodboardItems, textures } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Header } from "~/components/Header";

interface TextItem { text: string; }
interface ImageItem { url: string; caption?: string; }
interface TextureItem { textureId: string; filename: string; }
interface LinkItem { url: string; title?: string; }

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

  const userTextures = await db.query.textures.findMany({
    where: eq(textures.uploaderId, user.id),
    orderBy: [desc(textures.createdAt)],
    limit: 50,
  });

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
      content: JSON.stringify({ text } as TextItem),
    });
    return { success: true };
  }

  if (intent === "addImage") {
    const url = formData.get("url") as string;
    if (!url) return { error: "URL required" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "image",
      content: JSON.stringify({ url, caption: formData.get("caption") } as ImageItem),
    });
    return { success: true };
  }

  if (intent === "addTexture") {
    const textureId = formData.get("textureId") as string;
    const texture = await db.query.textures.findFirst({
      where: eq(textures.id, textureId),
    });
    if (!texture) return { error: "Texture not found" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: params.id!,
      type: "texture",
      content: JSON.stringify({ textureId: texture.id, filename: texture.filename } as TextureItem),
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
      content: JSON.stringify({ url, title: formData.get("title") } as LinkItem),
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

            {/* Image */}
            <Form method="post" className="card">
              <input type="hidden" name="intent" value="addImage" />
              <div className="section-title">Add Image</div>
              <input type="url" name="url" placeholder="URL" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} required />
              <input type="text" name="caption" placeholder="Caption" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} />
              <button type="submit" className="btn btn-sm">Add</button>
            </Form>

            {/* Texture */}
            {userTextures.length > 0 && (
              <Form method="post" className="card">
                <input type="hidden" name="intent" value="addTexture" />
                <div className="section-title">Add Texture</div>
                <select name="textureId" className="input" style={{ width: "100%", marginBottom: "0.5rem" }} required>
                  <option value="">Select...</option>
                  {userTextures.map((t) => (
                    <option key={t.id} value={t.id}>{t.originalName}</option>
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
          </div>

          {/* Board */}
          <div>
            {items.length === 0 ? (
              <div className="empty-state">Empty board</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.5rem" }}>
                {items.map((item) => {
                  const content = JSON.parse(item.content);
                  return (
                    <div key={item.id} className="card" style={{ position: "relative", padding: "0.5rem" }}>
                      {item.type === "text" && (
                        <p style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{content.text}</p>
                      )}
                      {item.type === "image" && (
                        <img src={content.url} alt={content.caption || ""} style={{ width: "100%" }} loading="lazy" />
                      )}
                      {item.type === "texture" && (
                        <img src={`/uploads/${content.filename}`} alt="" style={{ width: "100%" }} loading="lazy" />
                      )}
                      {item.type === "link" && (
                        <a href={content.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", wordBreak: "break-all" }}>
                          {content.title || content.url}
                        </a>
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

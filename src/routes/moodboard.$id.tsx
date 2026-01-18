import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/moodboard.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, moodboards, moodboardItems, textures } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

interface TextItem {
  text: string;
  color?: string;
}

interface ImageItem {
  url: string;
  caption?: string;
}

interface TextureItem {
  textureId: string;
  filename: string;
}

interface LinkItem {
  url: string;
  title?: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const boardId = params.id!;

  const board = await db.query.moodboards.findFirst({
    where: eq(moodboards.id, boardId),
  });

  if (!board) {
    throw new Response("Moodboard not found", { status: 404 });
  }

  if (board.ownerId !== user.id) {
    throw new Response("Not authorized", { status: 403 });
  }

  const items = await db.query.moodboardItems.findMany({
    where: eq(moodboardItems.moodboardId, boardId),
    orderBy: [desc(moodboardItems.createdAt)],
  });

  // Get user's textures for adding
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

  const boardId = params.id!;

  const board = await db.query.moodboards.findFirst({
    where: eq(moodboards.id, boardId),
  });

  if (!board || board.ownerId !== user.id) {
    return redirect("/moodboards");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "addText") {
    const text = formData.get("text") as string;
    const color = formData.get("color") as string;

    if (!text) {
      return { error: "Text is required" };
    }

    const content: TextItem = { text, color: color || "white" };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: boardId,
      type: "text",
      content: JSON.stringify(content),
    });

    return { success: "Text added" };
  }

  if (intent === "addImage") {
    const url = formData.get("url") as string;
    const caption = formData.get("caption") as string;

    if (!url) {
      return { error: "Image URL is required" };
    }

    const content: ImageItem = { url, caption };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: boardId,
      type: "image",
      content: JSON.stringify(content),
    });

    return { success: "Image added" };
  }

  if (intent === "addTexture") {
    const textureId = formData.get("textureId") as string;

    if (!textureId) {
      return { error: "Select a texture" };
    }

    const texture = await db.query.textures.findFirst({
      where: eq(textures.id, textureId),
    });

    if (!texture) {
      return { error: "Texture not found" };
    }

    const content: TextureItem = {
      textureId: texture.id,
      filename: texture.filename,
    };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: boardId,
      type: "texture",
      content: JSON.stringify(content),
    });

    return { success: "Texture added" };
  }

  if (intent === "addLink") {
    const url = formData.get("url") as string;
    const title = formData.get("title") as string;

    if (!url) {
      return { error: "URL is required" };
    }

    const content: LinkItem = { url, title };

    await db.insert(moodboardItems).values({
      id: nanoid(),
      moodboardId: boardId,
      type: "link",
      content: JSON.stringify(content),
    });

    return { success: "Link added" };
  }

  if (intent === "deleteItem") {
    const itemId = formData.get("itemId") as string;
    await db.delete(moodboardItems).where(eq(moodboardItems.id, itemId));
    return { success: "Item removed" };
  }

  return null;
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.board?.name || "Moodboard"} - artbin` }];
}

export default function MoodboardView() {
  const { board, items, userTextures } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-yellow p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <a href="/moodboards" className="text-sm text-gray hover:text-white">
              &larr; Back to Moodboards
            </a>
            <h1 className="text-2xl font-bold text-yellow">{board.name}</h1>
          </div>
          <nav className="flex items-center gap-4">
            <a href="/textures" className="btn">Textures</a>
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        {board.description && (
          <p className="text-center text-gray mb-4">{board.description}</p>
        )}
        <hr className="hr-rainbow my-4" />

        {actionData?.error && (
          <div className="box-warning mb-4 text-center">
            {actionData.error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Items Panel */}
          <div className="space-y-4">
            {/* Add Text */}
            <div className="box-retro">
              <h3 className="text-lg font-bold text-lime mb-3">Add Text</h3>
              <Form method="post" className="space-y-2">
                <input type="hidden" name="intent" value="addText" />
                <textarea
                  name="text"
                  rows={2}
                  placeholder="Your note..."
                  className="input-retro w-full text-sm"
                  required
                />
                <select name="color" className="input-retro w-full text-sm">
                  <option value="white">White</option>
                  <option value="lime">Lime</option>
                  <option value="aqua">Aqua</option>
                  <option value="yellow">Yellow</option>
                  <option value="fuchsia">Fuchsia</option>
                </select>
                <button type="submit" className="btn btn-success w-full text-sm">
                  Add Text
                </button>
              </Form>
            </div>

            {/* Add Image URL */}
            <div className="box-retro">
              <h3 className="text-lg font-bold text-aqua mb-3">Add Image URL</h3>
              <Form method="post" className="space-y-2">
                <input type="hidden" name="intent" value="addImage" />
                <input
                  type="url"
                  name="url"
                  placeholder="https://..."
                  className="input-retro w-full text-sm"
                  required
                />
                <input
                  type="text"
                  name="caption"
                  placeholder="Caption (optional)"
                  className="input-retro w-full text-sm"
                />
                <button type="submit" className="btn btn-primary w-full text-sm">
                  Add Image
                </button>
              </Form>
            </div>

            {/* Add Texture */}
            {userTextures.length > 0 && (
              <div className="box-retro">
                <h3 className="text-lg font-bold text-fuchsia mb-3">Add Texture</h3>
                <Form method="post" className="space-y-2">
                  <input type="hidden" name="intent" value="addTexture" />
                  <select name="textureId" className="input-retro w-full text-sm" required>
                    <option value="">Select texture...</option>
                    {userTextures.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.originalName}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-primary w-full text-sm">
                    Add Texture
                  </button>
                </Form>
              </div>
            )}

            {/* Add Link */}
            <div className="box-retro">
              <h3 className="text-lg font-bold text-yellow mb-3">Add Link</h3>
              <Form method="post" className="space-y-2">
                <input type="hidden" name="intent" value="addLink" />
                <input
                  type="url"
                  name="url"
                  placeholder="https://..."
                  className="input-retro w-full text-sm"
                  required
                />
                <input
                  type="text"
                  name="title"
                  placeholder="Title (optional)"
                  className="input-retro w-full text-sm"
                />
                <button type="submit" className="btn w-full text-sm">
                  Add Link
                </button>
              </Form>
            </div>
          </div>

          {/* Board Content */}
          <div className="lg:col-span-2">
            {items.length === 0 ? (
              <div className="box-retro text-center py-12">
                <p className="text-xl text-gray mb-4">This board is empty</p>
                <p className="text-sm text-gray">
                  Add text, images, textures, or links from the panel on the left
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {items.map((item) => {
                  const content = JSON.parse(item.content);

                  return (
                    <div
                      key={item.id}
                      className="border-4 border-fuchsia p-2 relative group"
                    >
                      {item.type === "text" && (
                        <div
                          className="p-2 min-h-16"
                          style={{ color: content.color || "white" }}
                        >
                          <p className="text-sm whitespace-pre-wrap">{content.text}</p>
                        </div>
                      )}

                      {item.type === "image" && (
                        <div>
                          <img
                            src={content.url}
                            alt={content.caption || ""}
                            className="w-full h-auto"
                            loading="lazy"
                          />
                          {content.caption && (
                            <p className="text-xs text-gray mt-1">{content.caption}</p>
                          )}
                        </div>
                      )}

                      {item.type === "texture" && (
                        <div>
                          <img
                            src={`/uploads/${content.filename}`}
                            alt="texture"
                            className="w-full h-auto"
                            loading="lazy"
                          />
                        </div>
                      )}

                      {item.type === "link" && (
                        <div className="p-2 min-h-16 flex items-center">
                          <a
                            href={content.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-aqua hover:text-lime text-sm break-all"
                          >
                            {content.title || content.url}
                          </a>
                        </div>
                      )}

                      {/* Delete button */}
                      <Form method="post" className="absolute top-1 right-1 opacity-0 group-hover:opacity-100">
                        <input type="hidden" name="intent" value="deleteItem" />
                        <input type="hidden" name="itemId" value={item.id} />
                        <button
                          type="submit"
                          className="bg-red text-white px-2 py-0.5 text-xs"
                        >
                          X
                        </button>
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

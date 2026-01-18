import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/upload";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, collections, textures } from "~/db";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get user's collections
  const userCollections = await db.query.collections.findMany({
    where: eq(collections.ownerId, user.id),
    orderBy: [desc(collections.createdAt)],
  });

  return { user, collections: userCollections };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Create new collection
  if (intent === "createCollection") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const visibility = formData.get("visibility") as "public" | "private" | "friends";

    if (!name) {
      return { error: "Collection name is required" };
    }

    await db.insert(collections).values({
      id: nanoid(),
      name,
      description: description || null,
      ownerId: user.id,
      visibility: visibility || "public",
    });

    return { success: "Collection created!" };
  }

  // Upload texture
  if (intent === "uploadTexture") {
    const file = formData.get("file") as File;
    const collectionId = formData.get("collectionId") as string | null;
    const isSeamless = formData.get("isSeamless") === "on";

    if (!file || file.size === 0) {
      return { error: "Please select a file" };
    }

    // Validate file type
    const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return { error: "Only PNG, JPEG, GIF, and WebP files are allowed" };
    }

    // Generate unique filename
    const ext = file.name.split(".").pop();
    const filename = `${nanoid()}.${ext}`;

    // Ensure uploads directory exists
    const uploadsDir = join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(uploadsDir, filename), buffer);

    // Insert into database
    await db.insert(textures).values({
      id: nanoid(),
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      isSeamless,
      collectionId: collectionId || null,
      uploaderId: user.id,
    });

    return { success: "Texture uploaded!" };
  }

  return null;
}

export function meta() {
  return [{ title: "Upload - artbin" }];
}

export default function Upload() {
  const { user, collections } = useLoaderData<typeof loader>();
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
            <a href="/textures" className="btn">Browse</a>
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-aqua mb-2">
          :: Upload Textures ::
        </h2>
        <hr className="hr-rainbow my-4" />

        {actionData?.error && (
          <div className="box-warning mb-4 text-center">
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div className="box-highlight mb-4 text-center">
            {actionData.success}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Upload Form */}
          <div className="box-retro">
            <h3 className="text-xl font-bold text-lime mb-4">Upload Texture</h3>
            <Form method="post" encType="multipart/form-data" className="space-y-4">
              <input type="hidden" name="intent" value="uploadTexture" />

              <div>
                <label htmlFor="file" className="block text-aqua mb-1">
                  Select File:
                </label>
                <input
                  type="file"
                  id="file"
                  name="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  required
                  className="input-retro w-full"
                />
              </div>

              <div>
                <label htmlFor="collectionId" className="block text-aqua mb-1">
                  Collection (optional):
                </label>
                <select
                  id="collectionId"
                  name="collectionId"
                  className="input-retro w-full"
                >
                  <option value="">-- No Collection --</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isSeamless"
                  name="isSeamless"
                  className="w-4 h-4"
                />
                <label htmlFor="isSeamless" className="text-aqua">
                  Seamless / Tileable
                </label>
              </div>

              <button type="submit" className="btn btn-primary w-full">
                Upload
              </button>
            </Form>
          </div>

          {/* Create Collection Form */}
          <div className="box-retro">
            <h3 className="text-xl font-bold text-yellow mb-4">Create Collection</h3>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="createCollection" />

              <div>
                <label htmlFor="name" className="block text-aqua mb-1">
                  Name:
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
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
                  className="input-retro w-full"
                />
              </div>

              <div>
                <label htmlFor="visibility" className="block text-aqua mb-1">
                  Visibility:
                </label>
                <select
                  id="visibility"
                  name="visibility"
                  className="input-retro w-full"
                >
                  <option value="public">Public (all users)</option>
                  <option value="private">Private (only you)</option>
                  <option value="friends">Friends only</option>
                </select>
              </div>

              <button type="submit" className="btn btn-success w-full">
                Create Collection
              </button>
            </Form>

            {collections.length > 0 && (
              <div className="mt-4">
                <h4 className="text-lg font-bold text-fuchsia mb-2">Your Collections:</h4>
                <ul className="space-y-1">
                  {collections.map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className="text-lime">{c.name}</span>
                      <span className="text-gray ml-2">({c.visibility})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

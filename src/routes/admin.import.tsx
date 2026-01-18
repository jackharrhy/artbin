import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, collections, tags, textureTags } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

interface TextureTownManifest {
  info: {
    base_url: string;
    textures_folder: string;
    texture_count: number;
  };
  catalogue: Array<{
    name: string;
    niceName: string;
    files: string[];
  }>;
}

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/dashboard");
  }

  // Fetch TextureTown manifest
  const res = await fetch("https://textures.neocities.org/manifest.json");
  const manifest: TextureTownManifest = await res.json();

  return { user, manifest };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const category = formData.get("category") as string;
  const limit = parseInt(formData.get("limit") as string) || 10;

  if (!category) {
    return { error: "Select a category" };
  }

  // Fetch manifest
  const res = await fetch("https://textures.neocities.org/manifest.json");
  const manifest: TextureTownManifest = await res.json();

  const cat = manifest.catalogue.find((c) => c.name === category);
  if (!cat) {
    return { error: "Category not found" };
  }

  // Create or find collection for this category
  let collection = await db.query.collections.findFirst({
    where: eq(collections.name, `TextureTown: ${cat.niceName}`),
  });

  if (!collection) {
    const [newCollection] = await db
      .insert(collections)
      .values({
        id: nanoid(),
        name: `TextureTown: ${cat.niceName}`,
        description: `Imported from TextureTown - ${cat.niceName}`,
        ownerId: user.id,
        visibility: "public",
      })
      .returning();
    collection = newCollection;
  }

  // Create tag for this category
  const tagSlug = cat.name;
  let tag = await db.query.tags.findFirst({
    where: eq(tags.slug, tagSlug),
  });

  if (!tag) {
    const [newTag] = await db
      .insert(tags)
      .values({
        id: nanoid(),
        name: cat.niceName,
        slug: tagSlug,
      })
      .returning();
    tag = newTag;
  }

  // Import textures
  const uploadsDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  let imported = 0;
  const files = cat.files.slice(0, limit);

  for (const file of files) {
    try {
      const url = `${manifest.info.base_url}/${manifest.info.textures_folder}/${cat.name}/${file}`;
      
      // Check if already imported
      const existing = await db.query.textures.findFirst({
        where: eq(textures.sourceUrl, url),
      });

      if (existing) {
        continue;
      }

      // Download the texture
      const imgRes = await fetch(url);
      if (!imgRes.ok) continue;

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const ext = file.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${nanoid()}.${ext}`;

      await writeFile(join(uploadsDir, filename), buffer);

      // Determine mime type
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        png: "image/png",
        webp: "image/webp",
      };

      const [texture] = await db
        .insert(textures)
        .values({
          id: nanoid(),
          filename,
          originalName: file,
          mimeType: mimeMap[ext] || "image/jpeg",
          size: buffer.length,
          collectionId: collection.id,
          uploaderId: user.id,
          sourceUrl: url,
        })
        .returning();

      // Add tag
      await db.insert(textureTags).values({
        textureId: texture.id,
        tagId: tag.id,
      }).onConflictDoNothing();

      imported++;
    } catch (e) {
      console.error(`Failed to import ${file}:`, e);
    }
  }

  return { success: `Imported ${imported} textures from ${cat.niceName}` };
}

export function meta() {
  return [{ title: "Import Textures - Admin - artbin" }];
}

export default function AdminImport() {
  const { user, manifest } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b-4 border-red p-4 bg-maroon">
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
          <span className="tag tag-fire">ADMIN</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-yellow mb-2">
          :: Import from TextureTown ::
        </h2>
        <p className="text-center text-sm mb-4">
          Total available: {manifest.info.texture_count} textures
        </p>
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

        <div className="box-retro">
          <Form method="post" className="space-y-4">
            <div>
              <label htmlFor="category" className="block text-lime mb-1">
                Category:
              </label>
              <select
                id="category"
                name="category"
                required
                className="input-retro w-full"
              >
                <option value="">-- Select Category --</option>
                {manifest.catalogue.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.niceName} ({cat.files.length} textures)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="limit" className="block text-lime mb-1">
                Import Limit:
              </label>
              <select id="limit" name="limit" className="input-retro w-full">
                <option value="5">5 textures</option>
                <option value="10">10 textures</option>
                <option value="25">25 textures</option>
                <option value="50">50 textures</option>
                <option value="100">100 textures</option>
              </select>
            </div>

            <button type="submit" className="btn btn-danger w-full">
              Import Textures
            </button>
          </Form>
        </div>

        <div className="mt-8">
          <h3 className="text-xl font-bold text-fuchsia mb-4">Categories:</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {manifest.catalogue.map((cat) => (
              <div key={cat.name} className="p-2 border-2 border-fuchsia text-sm">
                <span className="text-lime">{cat.niceName}</span>
                <span className="text-gray ml-2">({cat.files.length})</span>
              </div>
            ))}
          </div>
        </div>

        <hr className="hr-dashed my-8" />

        <p className="text-center text-sm">
          <a href="/dashboard">Back to Dashboard</a>
        </p>
      </main>
    </div>
  );
}

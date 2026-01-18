import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, folders, tags, textureTags } from "~/db";
import { eq, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro textures organized by category",
    url: "https://textures.neocities.org/",
  },
];

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

  // Get current texture count
  const [{ total }] = await db.select({ total: count() }).from(textures);
  
  // Get folder count
  const [{ folderCount }] = await db.select({ folderCount: count() }).from(folders);

  return { user, sources: IMPORT_SOURCES, textureCount: total, folderCount };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const source = formData.get("source") as string;

  if (source === "texturetown") {
    return await importTextureTown();
  }

  return { error: "Unknown import source" };
}

async function importTextureTown() {
  // Fetch manifest
  const res = await fetch("https://textures.neocities.org/manifest.json");
  const manifest: TextureTownManifest = await res.json();

  const uploadsDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  let totalImported = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  // Create parent folder for TextureTown
  let parentFolder = await db.query.folders.findFirst({
    where: eq(folders.slug, "texturetown"),
  });

  if (!parentFolder) {
    const [newFolder] = await db
      .insert(folders)
      .values({
        id: nanoid(),
        name: "TextureTown",
        slug: "texturetown",
        description: `Imported from textures.neocities.org - ${manifest.info.texture_count} textures`,
        parentId: null,
        ownerId: null,
        visibility: "public",
        source: "texturetown",
      })
      .returning();
    parentFolder = newFolder;
  }

  // Import ALL categories as child folders
  for (const cat of manifest.catalogue) {
    // Create child folder for this category
    const folderSlug = `texturetown/${cat.name}`;
    let categoryFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, folderSlug),
    });

    if (!categoryFolder) {
      const [newFolder] = await db
        .insert(folders)
        .values({
          id: nanoid(),
          name: cat.niceName,
          slug: folderSlug,
          description: `${cat.files.length} textures`,
          parentId: parentFolder.id,
          ownerId: null,
          visibility: "public",
          source: "texturetown",
        })
        .returning();
      categoryFolder = newFolder;
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

    // Import ALL files in this category
    for (const file of cat.files) {
      try {
        const url = `${manifest.info.base_url}/${manifest.info.textures_folder}/${cat.name}/${file}`;

        // Check if already imported
        const existing = await db.query.textures.findFirst({
          where: eq(textures.sourceUrl, url),
        });

        if (existing) {
          totalSkipped++;
          continue;
        }

        // Download the texture
        const imgRes = await fetch(url);
        if (!imgRes.ok) {
          errors.push(`Failed to fetch ${file}`);
          continue;
        }

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
            folderId: categoryFolder.id,
            uploaderId: null,
            source: "texturetown",
            sourceUrl: url,
          })
          .returning();

        // Add tag
        await db
          .insert(textureTags)
          .values({
            textureId: texture.id,
            tagId: tag.id,
          })
          .onConflictDoNothing();

        totalImported++;
      } catch (e) {
        errors.push(`Error importing ${file}: ${e}`);
      }
    }
  }

  return {
    success: `Imported ${totalImported} textures into ${manifest.catalogue.length} folders (${totalSkipped} already existed)`,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };
}

export function meta() {
  return [{ title: "Import - Admin - artbin" }];
}

export default function AdminImport() {
  const { sources, textureCount, folderCount } = useLoaderData<typeof loader>();
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
          :: Import Textures ::
        </h2>
        <p className="text-center text-sm mb-4">
          Library: {textureCount} textures in {folderCount} folders
        </p>
        <hr className="hr-rainbow my-4" />

        {"error" in (actionData || {}) && (
          <div className="box-warning mb-4 text-center">{(actionData as { error: string }).error}</div>
        )}

        {"success" in (actionData || {}) && (
          <div className="box-highlight mb-4">
            <p className="text-center font-bold">{(actionData as { success: string; errors?: string[] }).success}</p>
            {(actionData as { success: string; errors?: string[] }).errors && (actionData as { success: string; errors?: string[] }).errors!.length > 0 && (
              <div className="mt-2 text-sm text-yellow">
                <p>Some errors occurred:</p>
                <ul className="list-disc list-inside">
                  {(actionData as { success: string; errors?: string[] }).errors!.map((err: string, i: number) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Import Sources */}
        <div className="space-y-4">
          {sources.map((source) => (
            <div key={source.id} className="box-retro">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-lime">{source.name}</h3>
                  <p className="text-sm text-gray mb-2">{source.description}</p>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs"
                  >
                    {source.url}
                  </a>
                </div>
                <Form method="post">
                  <input type="hidden" name="source" value={source.id} />
                  <button
                    type="submit"
                    className="btn btn-danger"
                    onClick={(e) => {
                      if (
                        !confirm(
                          `Import ALL textures from ${source.name}? This may take a while.`
                        )
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Import All
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>

        <hr className="hr-dashed my-8" />

        <div className="box-inset">
          <h3 className="text-lg font-bold mb-2">How Import Works</h3>
          <ul className="list-disc list-inside text-sm space-y-1">
            <li>Creates a parent folder for the source (e.g. "TextureTown")</li>
            <li>Creates child folders for each category</li>
            <li>Downloads all textures into their folders</li>
            <li>Auto-tags textures by category</li>
            <li>Skips textures already imported (by URL)</li>
            <li>May take several minutes for large sources</li>
          </ul>
        </div>

        <hr className="hr-dashed my-8" />

        <p className="text-center text-sm">
          <a href="/dashboard">Back to Dashboard</a> | <a href="/folders">Browse Folders</a>
        </p>
      </main>
    </div>
  );
}

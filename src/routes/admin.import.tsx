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
    <div>
      <header className="header">
        <a href="/textures" className="header-logo">artbin</a>
        <span className="badge-admin">admin</span>
      </header>

      <main className="main-content" style={{ maxWidth: "600px" }}>
        <h1 className="page-title">Import Textures</h1>
        <p className="grid-count" style={{ marginBottom: "1rem" }}>
          {textureCount} textures in {folderCount} folders
        </p>

        {"error" in (actionData || {}) && (
          <div className="alert alert-error">{(actionData as { error: string }).error}</div>
        )}

        {"success" in (actionData || {}) && (
          <div className="alert alert-success">
            {(actionData as { success: string; errors?: string[] }).success}
          </div>
        )}

        {sources.map((source) => (
          <div key={source.id} className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem" }}>
              <div>
                <div style={{ fontWeight: "500" }}>{source.name}</div>
                <div className="form-help">{source.description}</div>
              </div>
              <Form method="post">
                <input type="hidden" name="source" value={source.id} />
                <button
                  type="submit"
                  className="btn btn-sm"
                  onClick={(e) => {
                    if (!confirm(`Import from ${source.name}?`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Import
                </button>
              </Form>
            </div>
          </div>
        ))}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <a href="/admin/extract">Extract Game Files</a> | <a href="/settings">Settings</a> | <a href="/folders">Folders</a>
        </p>
      </main>
    </div>
  );
}

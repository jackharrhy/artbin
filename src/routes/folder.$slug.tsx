import { useLoaderData, redirect, Form, useNavigation } from "react-router";
import type { Route } from "./+types/folder.$slug";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures, users } from "~/db";
import { eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { unlink } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Combine slug and splat for nested folder paths
  // Route is folder/:slug/* so /folder/parent/child gives slug="parent", *="child"
  const slug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder) {
    throw new Response("Folder not found", { status: 404 });
  }

  // Get child folders
  const childFolders = await db.query.folders.findMany({
    where: eq(folders.parentId, folder.id),
    orderBy: [folders.name],
  });

  // Get parent folder if exists
  let parentFolder = null;
  if (folder.parentId) {
    parentFolder = await db.query.folders.findFirst({
      where: eq(folders.id, folder.parentId),
    });
  }

  // Get textures in this folder
  const folderTextures = await db
    .select({
      id: textures.id,
      filename: textures.filename,
      previewFilename: textures.previewFilename,
      originalName: textures.originalName,
      isSeamless: textures.isSeamless,
    })
    .from(textures)
    .leftJoin(users, eq(textures.uploaderId, users.id))
    .where(eq(textures.folderId, folder.id))
    .orderBy(desc(textures.createdAt))
    .limit(500);

  return { user, folder, childFolders, parentFolder, textures: folderTextures };
}

export async function action({ request, params }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Combine slug and splat for nested folder paths
  const slug = params["*"] ? `${params.slug}/${params["*"]}` : params.slug!;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (!folder) {
    return { error: "Folder not found" };
  }

  if (actionType === "delete") {
    // Get all textures in this folder
    const folderTextures = await db.query.textures.findMany({
      where: eq(textures.folderId, folder.id),
    });

    // Delete texture files from disk
    for (const texture of folderTextures) {
      try {
        await unlink(join(UPLOADS_DIR, texture.filename));
      } catch {
        // File may not exist, continue
      }
      // Also delete preview file if exists
      if (texture.previewFilename) {
        try {
          await unlink(join(UPLOADS_DIR, texture.previewFilename));
        } catch {
          // File may not exist, continue
        }
      }
    }

    // Delete texture records
    await db.delete(textures).where(eq(textures.folderId, folder.id));

    // Check for child folders
    const childFolders = await db.query.folders.findMany({
      where: eq(folders.parentId, folder.id),
    });

    if (childFolders.length > 0) {
      // Update child folders to have no parent (move to root)
      for (const child of childFolders) {
        await db
          .update(folders)
          .set({ parentId: null })
          .where(eq(folders.id, child.id));
      }
    }

    // Delete the folder
    await db.delete(folders).where(eq(folders.id, folder.id));

    return redirect("/folders");
  }

  return { error: "Unknown action" };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder?.name || "Folder"} - artbin` }];
}

export default function FolderView() {
  const { user, folder, childFolders, parentFolder, textures } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isDeleting = navigation.state === "submitting" && 
    navigation.formData?.get("_action") === "delete";

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          {parentFolder && (
            <>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${parentFolder.slug}`}>{parentFolder.name}</a>
            </>
          )}
          <span className="breadcrumb-sep">/</span>
          <span>{folder.name}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>{folder.name}</h1>
          
          {user.isAdmin && (
            <Form 
              method="post" 
              onSubmit={(e) => {
                const textureCount = textures.length;
                const msg = textureCount > 0
                  ? `Delete folder "${folder.name}" and ${textureCount} texture(s)? This will permanently delete all files.`
                  : `Delete empty folder "${folder.name}"?`;
                if (!confirm(msg)) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="_action" value="delete" />
              <button 
                type="submit" 
                className="btn btn-danger"
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete Folder"}
              </button>
            </Form>
          )}
        </div>

        {/* Child Folders */}
        {childFolders.length > 0 && (
          <section className="section">
            <h2 className="section-title">Subfolders</h2>
            <div className="folder-grid">
              {childFolders.map((child) => (
                <a
                  key={child.id}
                  href={`/folder/${child.slug}`}
                  className="folder-card"
                >
                  <div className="folder-name">{child.name}</div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Textures */}
        {textures.length > 0 && (
          <section className="section">
            <div className="grid-header">
              <span className="grid-count">{textures.length} textures</span>
            </div>
            <div className="texture-grid">
              {textures.map((texture) => (
                <a
                  key={texture.id}
                  href={`/texture/${texture.id}`}
                  className="texture-card"
                >
                  <img
                    src={`/uploads/${texture.previewFilename || texture.filename}`}
                    alt={texture.originalName}
                    loading="lazy"
                  />
                  <div className="texture-card-info">
                    {texture.originalName}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {childFolders.length === 0 && textures.length === 0 && (
          <div className="empty-state">
            This folder is empty
          </div>
        )}
      </main>
    </div>
  );
}

import { useLoaderData, redirect, Form, useNavigation } from "react-router";
import type { Route } from "./+types/folder.$slug";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files } from "~/db";
import { eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";
import { deleteFile, deleteFolder } from "~/lib/files.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Combine slug and splat for nested folder paths
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

  // Build ancestor chain for breadcrumbs
  const ancestors: { id: string; name: string; slug: string }[] = [];
  let currentParentId = folder.parentId;
  while (currentParentId) {
    const parent = await db.query.folders.findFirst({
      where: eq(folders.id, currentParentId),
    });
    if (!parent) break;
    ancestors.unshift(parent); // Add to front to maintain order
    currentParentId = parent.parentId;
  }

  // Get files in this folder
  const folderFiles = await db
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      kind: files.kind,
      mimeType: files.mimeType,
      size: files.size,
      width: files.width,
      height: files.height,
      hasPreview: files.hasPreview,
    })
    .from(files)
    .where(eq(files.folderId, folder.id))
    .orderBy(desc(files.createdAt))
    .limit(500);

  return { user, folder, childFolders, ancestors, files: folderFiles };
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
    // Recursively delete folder, children, and files
    async function deleteFolderRecursive(folderId: string, folderSlug: string) {
      // Get all files in this folder
      const folderFiles = await db.query.files.findMany({
        where: eq(files.folderId, folderId),
      });

      // Delete file records and files from disk
      for (const file of folderFiles) {
        await deleteFile(file.path);
      }
      await db.delete(files).where(eq(files.folderId, folderId));

      // Recursively delete child folders
      const childFolders = await db.query.folders.findMany({
        where: eq(folders.parentId, folderId),
      });

      for (const child of childFolders) {
        await deleteFolderRecursive(child.id, child.slug);
      }

      // Delete the folder record and directory
      await db.delete(folders).where(eq(folders.id, folderId));
      await deleteFolder(folderSlug);
    }

    await deleteFolderRecursive(folder.id, folder.slug);

    return redirect("/folders");
  }

  return { error: "Unknown action" };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder?.name || "Folder"} - artbin` }];
}

/**
 * Get the display URL for a file (preview if available, otherwise original)
 */
function getFileDisplayUrl(file: {
  path: string;
  hasPreview: boolean | null;
  kind: string | null;
}): string | null {
  if (file.kind !== "texture") return null;
  
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

/**
 * Get icon for non-image file kinds
 */
function getFileIcon(kind: string | null): string {
  switch (kind) {
    case "model":
      return "📦";
    case "audio":
      return "🔊";
    case "map":
      return "🗺️";
    case "archive":
      return "📁";
    case "config":
      return "📄";
    default:
      return "📎";
  }
}

export default function FolderView() {
  const { user, folder, childFolders, ancestors, files } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isDeleting =
    navigation.state === "submitting" &&
    navigation.formData?.get("_action") === "delete";

  // Separate files by kind for display
  const textures = files.filter((f) => f.kind === "texture");
  const otherFiles = files.filter((f) => f.kind !== "texture");

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${ancestor.slug}`}>{ancestor.name}</a>
            </span>
          ))}
          <span className="breadcrumb-sep">/</span>
          <span>{folder.name}</span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {folder.name}
          </h1>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <a href={`/upload?folder=${encodeURIComponent(folder.slug)}`} className="btn btn-primary">
              Upload to folder
            </a>
            
            {user.isAdmin && (
              <Form
                method="post"
                style={{ display: "inline" }}
                onSubmit={(e) => {
                  const fileCount = files.length;
                  const folderCount = childFolders.length;
                  let msg = `Delete folder "${folder.name}"?`;
                  if (fileCount > 0 || folderCount > 0) {
                    msg = `Delete folder "${folder.name}" with ${fileCount} file(s) and ${folderCount} subfolder(s)? This will permanently delete all contents.`;
                  }
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
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </Form>
            )}
          </div>
        </div>

        {folder.description && (
          <p style={{ marginBottom: "1rem", color: "#666" }}>
            {folder.description}
          </p>
        )}

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

        {/* Textures (image files) */}
        {textures.length > 0 && (
          <section className="section">
            <div className="grid-header">
              <span className="grid-count">{textures.length} textures</span>
            </div>
            <div className="texture-grid">
              {textures.map((file) => (
                <a
                  key={file.id}
                  href={`/file/${file.path}`}
                  className="texture-card"
                >
                  <img
                    src={getFileDisplayUrl(file) || ""}
                    alt={file.name}
                    loading="lazy"
                  />
                  <div className="texture-card-info">{file.name}</div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Other Files */}
        {otherFiles.length > 0 && (
          <section className="section">
            <div className="grid-header">
              <span className="grid-count">{otherFiles.length} other files</span>
            </div>
            <div className="file-list">
              {otherFiles.map((file) => (
                <a
                  key={file.id}
                  href={`/file/${file.path}`}
                  className="file-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    borderBottom: "1px solid #eee",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span style={{ fontSize: "1.25rem" }}>
                    {getFileIcon(file.kind)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div>{file.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#999" }}>
                      {file.kind} • {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {childFolders.length === 0 && files.length === 0 && (
          <div className="empty-state">This folder is empty</div>
        )}
      </main>
    </div>
  );
}

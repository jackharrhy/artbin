import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/folder.$slug";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures, users } from "~/db";
import { eq, desc } from "drizzle-orm";
import { Header } from "~/components/Header";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const slug = params.slug!;

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

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder?.name || "Folder"} - artbin` }];
}

export default function FolderView() {
  const { user, folder, childFolders, parentFolder, textures } = useLoaderData<typeof loader>();

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

        <h1 className="page-title">{folder.name}</h1>

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

import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/folder.$slug";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures, users } from "~/db";
import { eq, desc } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const slug = params.slug!;

  // Find folder by slug (supports nested paths like "texturetown/wood")
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
      originalName: textures.originalName,
      isSeamless: textures.isSeamless,
      createdAt: textures.createdAt,
      uploaderUsername: users.username,
    })
    .from(textures)
    .leftJoin(users, eq(textures.uploaderId, users.id))
    .where(eq(textures.folderId, folder.id))
    .orderBy(desc(textures.createdAt))
    .limit(200);

  return { user, folder, childFolders, parentFolder, textures: folderTextures };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.folder?.name || "Folder"} - artbin` }];
}

export default function FolderView() {
  const { folder, childFolders, parentFolder, textures } = useLoaderData<typeof loader>();

  // Build breadcrumb
  const breadcrumbs = [];
  if (parentFolder) {
    breadcrumbs.push({ name: parentFolder.name, slug: parentFolder.slug });
  }
  breadcrumbs.push({ name: folder.name, slug: folder.slug });

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
            <a href="/textures" className="btn">All Textures</a>
            <a href="/folders" className="btn">Folders</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        {/* Breadcrumb */}
        <div className="mb-4 text-sm">
          <a href="/folders" className="text-gray hover:text-white">Folders</a>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.slug}>
              <span className="text-gray mx-2">/</span>
              {i === breadcrumbs.length - 1 ? (
                <span className="text-lime">{crumb.name}</span>
              ) : (
                <a href={`/folder/${crumb.slug}`} className="text-aqua hover:text-white">
                  {crumb.name}
                </a>
              )}
            </span>
          ))}
        </div>

        <h2 className="text-3xl font-bold text-lime mb-2">{folder.name}</h2>
        {folder.description && (
          <p className="text-gray mb-4">{folder.description}</p>
        )}
        <hr className="hr-rainbow my-4" />

        {/* Child Folders */}
        {childFolders.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xl font-bold text-aqua mb-4">Subfolders</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {childFolders.map((child) => (
                <a
                  key={child.id}
                  href={`/folder/${child.slug}`}
                  className="p-3 border-2 border-fuchsia hover:border-lime text-center"
                >
                  <div className="text-2xl mb-1">📁</div>
                  <div className="text-sm text-lime truncate">{child.name}</div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Textures */}
        {textures.length > 0 ? (
          <>
            <h3 className="text-xl font-bold text-aqua mb-4">
              Textures ({textures.length})
            </h3>
            <div className="texture-grid">
              {textures.map((texture) => (
                <a
                  key={texture.id}
                  href={`/texture/${texture.id}`}
                  className="texture-card"
                >
                  <img
                    src={`/uploads/${texture.filename}`}
                    alt={texture.originalName}
                    loading="lazy"
                  />
                  <div className="mt-2 text-xs">
                    <p className="text-lime truncate" title={texture.originalName}>
                      {texture.originalName}
                    </p>
                    {texture.isSeamless && (
                      <span className="tag tag-seamless text-xs">seamless</span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </>
        ) : childFolders.length === 0 ? (
          <div className="box-retro text-center">
            <p className="text-xl text-gray">This folder is empty</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

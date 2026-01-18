import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/folders";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures } from "~/db";
import { eq, isNull, count, desc } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get root folders (no parent)
  const rootFolders = await db.query.folders.findMany({
    where: isNull(folders.parentId),
    orderBy: [desc(folders.createdAt)],
  });

  // Get texture counts for each folder
  const folderCounts: Record<string, number> = {};
  for (const folder of rootFolders) {
    // Count textures in this folder and all child folders
    const childFolders = await db.query.folders.findMany({
      where: eq(folders.parentId, folder.id),
    });
    
    const folderIds = [folder.id, ...childFolders.map(f => f.id)];
    let totalCount = 0;
    
    for (const fid of folderIds) {
      const [{ c }] = await db
        .select({ c: count() })
        .from(textures)
        .where(eq(textures.folderId, fid));
      totalCount += c;
    }
    
    folderCounts[folder.id] = totalCount;
  }

  return { user, folders: rootFolders, folderCounts };
}

export function meta() {
  return [{ title: "Folders - artbin" }];
}

export default function Folders() {
  const { folders, folderCounts } = useLoaderData<typeof loader>();

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
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-lime mb-2">
          :: Folders ::
        </h2>
        <p className="text-center text-sm mb-4">
          Browse textures organized by folder
        </p>
        <hr className="hr-rainbow my-4" />

        {folders.length === 0 ? (
          <div className="box-retro text-center">
            <p className="text-xl mb-4">No folders yet!</p>
            <p className="text-sm text-gray">
              Upload textures or import from external sources to create folders.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {folders.map((folder) => (
              <a
                key={folder.id}
                href={`/folder/${folder.slug}`}
                className="box-retro hover:border-lime"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-lime">{folder.name}</h3>
                    {folder.description && (
                      <p className="text-sm text-gray mt-1">{folder.description}</p>
                    )}
                  </div>
                  {folder.source && (
                    <span className="tag tag-pixel text-xs">{folder.source}</span>
                  )}
                </div>
                <div className="mt-3 text-sm">
                  <span className="text-aqua">{folderCounts[folder.id] || 0}</span>
                  <span className="text-gray"> textures</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

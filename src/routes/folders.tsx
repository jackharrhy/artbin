import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/folders";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures } from "~/db";
import { eq, isNull, count, desc } from "drizzle-orm";
import { Header } from "~/components/Header";

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
  const { user, folders, folderCounts } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        <h1 className="page-title">Folders</h1>

        {folders.length === 0 ? (
          <div className="empty-state">
            No folders yet
          </div>
        ) : (
          <div className="folder-grid">
            {folders.map((folder) => (
              <a
                key={folder.id}
                href={`/folder/${folder.slug}`}
                className="folder-card"
              >
                <div className="folder-name">{folder.name}</div>
                <div className="folder-meta">
                  {folderCounts[folder.id] || 0} textures
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

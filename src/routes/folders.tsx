import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/folders";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files } from "~/db";
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

  // Get file counts for each folder (including descendants)
  const folderCounts: Record<string, number> = {};
  
  async function countFilesRecursive(folderId: string): Promise<number> {
    // Count files in this folder
    const [{ c }] = await db
      .select({ c: count() })
      .from(files)
      .where(eq(files.folderId, folderId));
    
    // Count files in child folders
    const childFolders = await db.query.folders.findMany({
      where: eq(folders.parentId, folderId),
    });
    
    let total = c;
    for (const child of childFolders) {
      total += await countFilesRecursive(child.id);
    }
    
    return total;
  }
  
  for (const folder of rootFolders) {
    folderCounts[folder.id] = await countFilesRecursive(folder.id);
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Folders</h1>
          {user.isAdmin && (
            <a href="/admin/extract" className="btn btn-primary">
              Extract Archive
            </a>
          )}
        </div>

        {folders.length === 0 ? (
          <div className="empty-state">
            <p>No folders yet</p>
            {user.isAdmin && (
              <p style={{ marginTop: "1rem" }}>
                <a href="/admin/extract">Extract an archive</a> to create folders
              </p>
            )}
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
                  {folderCounts[folder.id] || 0} files
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

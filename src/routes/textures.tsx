import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/textures";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, collections, users } from "~/db";
import { eq, desc, or, isNull } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get all textures user can see (public collections + their own)
  const allTextures = await db
    .select({
      id: textures.id,
      filename: textures.filename,
      originalName: textures.originalName,
      isSeamless: textures.isSeamless,
      createdAt: textures.createdAt,
      uploaderUsername: users.username,
      collectionName: collections.name,
    })
    .from(textures)
    .leftJoin(collections, eq(textures.collectionId, collections.id))
    .leftJoin(users, eq(textures.uploaderId, users.id))
    .where(
      or(
        isNull(textures.collectionId),
        eq(collections.visibility, "public"),
        eq(collections.ownerId, user.id)
      )
    )
    .orderBy(desc(textures.createdAt))
    .limit(100);

  return { user, textures: allTextures };
}

export function meta() {
  return [{ title: "Textures - artbin" }];
}

export default function Textures() {
  const { user, textures } = useLoaderData<typeof loader>();

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
            <a href="/upload" className="btn btn-primary">Upload</a>
            <a href="/dashboard" className="btn">Dashboard</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-8">
        <h2 className="text-3xl font-bold text-center text-lime mb-2">
          :: Texture Library ::
        </h2>
        <p className="text-center text-sm mb-4">
          {textures.length} textures available
        </p>
        <hr className="hr-rainbow my-4" />

        {textures.length === 0 ? (
          <div className="box-retro text-center">
            <p className="text-xl mb-4">No textures yet!</p>
            <a href="/upload" className="btn btn-primary">
              Upload the first one
            </a>
          </div>
        ) : (
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
                  <p className="text-gray">
                    by @{texture.uploaderUsername}
                  </p>
                  {texture.isSeamless && (
                    <span className="tag tag-seamless text-xs">seamless</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/texture.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, folders, users, tags, textureTags } from "~/db";
import { eq } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const texture = await db.query.textures.findFirst({
    where: eq(textures.id, params.id!),
  });

  if (!texture) {
    throw new Response("Texture not found", { status: 404 });
  }

  // Get uploader info if exists
  let uploader = null;
  if (texture.uploaderId) {
    uploader = await db.query.users.findFirst({
      where: eq(users.id, texture.uploaderId),
    });
  }

  // Get folder info if exists
  let folder = null;
  if (texture.folderId) {
    folder = await db.query.folders.findFirst({
      where: eq(folders.id, texture.folderId),
    });
  }

  // Get tags
  const textureTagRecords = await db.query.textureTags.findMany({
    where: eq(textureTags.textureId, texture.id),
  });
  const tagIds = textureTagRecords.map((tt) => tt.tagId);
  const textureTags_ = tagIds.length > 0
    ? await Promise.all(
        tagIds.map((id) => db.query.tags.findFirst({ where: eq(tags.id, id) }))
      )
    : [];

  return {
    user,
    texture,
    uploader,
    folder,
    tags: textureTags_.filter(Boolean),
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.texture?.originalName || "Texture"} - artbin` }];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function TextureDetail() {
  const { texture, uploader, folder, tags } = useLoaderData<typeof loader>();

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

      <main className="max-w-4xl mx-auto p-8">
        {/* Breadcrumb */}
        <div className="mb-4 text-sm">
          <a href="/textures" className="text-gray hover:text-white">Textures</a>
          {folder && (
            <>
              <span className="text-gray mx-2">/</span>
              <a href={`/folder/${folder.slug}`} className="text-aqua hover:text-white">
                {folder.name}
              </a>
            </>
          )}
          <span className="text-gray mx-2">/</span>
          <span className="text-lime">{texture.originalName}</span>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Image */}
          <div className="box-retro p-2">
            <img
              src={`/uploads/${texture.filename}`}
              alt={texture.originalName}
              className="w-full"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="mt-4 flex gap-2 justify-center">
              <a
                href={`/uploads/${texture.filename}`}
                download={texture.originalName}
                className="btn btn-primary"
              >
                Download
              </a>
              {texture.sourceUrl && (
                <a
                  href={texture.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                >
                  Original Source
                </a>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div className="box-retro">
              <h2 className="text-2xl font-bold text-lime mb-4">
                {texture.originalName}
              </h2>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray">Size:</dt>
                  <dd>{formatBytes(texture.size)}</dd>
                </div>
                {texture.width && texture.height && (
                  <div className="flex justify-between">
                    <dt className="text-gray">Dimensions:</dt>
                    <dd>{texture.width} x {texture.height}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray">Type:</dt>
                  <dd>{texture.mimeType}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray">Uploaded:</dt>
                  <dd>
                    {uploader
                      ? `by @${uploader.username}`
                      : texture.source
                        ? `from ${texture.source}`
                        : "Unknown"}
                  </dd>
                </div>
                {folder && (
                  <div className="flex justify-between">
                    <dt className="text-gray">Folder:</dt>
                    <dd>
                      <a href={`/folder/${folder.slug}`} className="text-aqua hover:underline">
                        {folder.name}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="box-retro">
                <h3 className="text-lg font-bold text-aqua mb-2">Tags</h3>
                <div className="flex gap-2 flex-wrap">
                  {tags.map((tag) => (
                    <a
                      key={tag!.id}
                      href={`/textures?tag=${tag!.slug}`}
                      className="tag tag-pixel"
                    >
                      {tag!.name}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Seamless badge */}
            {texture.isSeamless && (
              <div className="box-highlight text-center">
                <span className="tag tag-seamless">Seamless Texture</span>
                <p className="text-xs mt-2 text-gray">
                  This texture tiles seamlessly!
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

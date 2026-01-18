import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/texture.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, folders, users, tags, textureTags } from "~/db";
import { eq } from "drizzle-orm";
import { Header } from "~/components/Header";

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

  let uploader = null;
  if (texture.uploaderId) {
    uploader = await db.query.users.findFirst({
      where: eq(users.id, texture.uploaderId),
    });
  }

  let folder = null;
  if (texture.folderId) {
    folder = await db.query.folders.findFirst({
      where: eq(folders.id, texture.folderId),
    });
  }

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
  const { user, texture, uploader, folder, tags } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/textures">Textures</a>
          {folder && (
            <>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${folder.slug}`}>{folder.name}</a>
            </>
          )}
          <span className="breadcrumb-sep">/</span>
          <span>{texture.originalName}</span>
        </div>

        <div className="detail-grid">
          {/* Image */}
          <div>
            <div className="detail-image">
              <img
                src={`/uploads/${texture.filename}`}
                alt={texture.originalName}
              />
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <a
                href={`/uploads/${texture.filename}`}
                download={texture.originalName}
                className="btn"
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
                  Source
                </a>
              )}
            </div>
          </div>

          {/* Info */}
          <div>
            <div className="card">
              <h1 style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
                {texture.originalName}
              </h1>
              <dl className="detail-info">
                <dt>Size</dt>
                <dd>{formatBytes(texture.size)}</dd>
                
                {texture.width && texture.height && (
                  <>
                    <dt>Dimensions</dt>
                    <dd>{texture.width} x {texture.height}</dd>
                  </>
                )}
                
                <dt>Type</dt>
                <dd>{texture.mimeType}</dd>
                
                <dt>Source</dt>
                <dd>
                  {uploader
                    ? `@${uploader.username}`
                    : texture.source || "Unknown"}
                </dd>
                
                {folder && (
                  <>
                    <dt>Folder</dt>
                    <dd>
                      <a href={`/folder/${folder.slug}`}>{folder.name}</a>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            {tags.length > 0 && (
              <div className="card" style={{ marginTop: "1rem" }}>
                <div className="section-title">Tags</div>
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  {tags.map((tag) => (
                    <a
                      key={tag!.id}
                      href={`/textures?tag=${tag!.slug}`}
                      className="tag"
                    >
                      {tag!.name}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {texture.isSeamless && (
              <div className="card" style={{ marginTop: "1rem" }}>
                <span className="tag tag-active">Seamless</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

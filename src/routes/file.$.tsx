import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/file.$";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders, fileTags, tags } from "~/db";
import { eq } from "drizzle-orm";
import { Header } from "~/components/Header";
import { basename, dirname, extname } from "path";

// Audio formats that browsers can play natively
const WEB_PLAYABLE_AUDIO = ["mp3", "ogg", "wav", "m4a", "webm", "aac"];

function isWebPlayableAudio(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return WEB_PLAYABLE_AUDIO.includes(ext);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get file path from splat
  const filePath = params["*"];
  if (!filePath) {
    throw new Response("File not found", { status: 404 });
  }

  // Find file by path
  const file = await db.query.files.findFirst({
    where: eq(files.path, filePath),
  });

  if (!file) {
    throw new Response("File not found", { status: 404 });
  }

  // Get folder
  let folder = null;
  if (file.folderId) {
    folder = await db.query.folders.findFirst({
      where: eq(folders.id, file.folderId),
    });
  }

  // Get tags
  const fileTagRecords = await db
    .select({ tag: tags })
    .from(fileTags)
    .innerJoin(tags, eq(fileTags.tagId, tags.id))
    .where(eq(fileTags.fileId, file.id));

  const fileTags_ = fileTagRecords.map((r) => r.tag);

  return { user, file, folder, tags: fileTags_ };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.file?.name || "File"} - artbin` }];
}

/**
 * Get display URL for file
 */
function getDisplayUrl(file: {
  path: string;
  hasPreview: boolean | null;
}): string {
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculate aspect ratio as a human-readable string
 */
function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const ratioW = width / divisor;
  const ratioH = height / divisor;

  // Common ratios
  if (ratioW === 1 && ratioH === 1) return "1:1";
  if (ratioW === 16 && ratioH === 9) return "16:9";
  if (ratioW === 4 && ratioH === 3) return "4:3";
  if (ratioW === 3 && ratioH === 2) return "3:2";
  if (ratioW === 2 && ratioH === 1) return "2:1";

  // If ratio numbers are reasonable, show them
  if (ratioW <= 32 && ratioH <= 32) {
    return `${ratioW}:${ratioH}`;
  }

  // Otherwise show decimal
  return (width / height).toFixed(2);
}

export default function FileView() {
  const { user, file, folder, tags } = useLoaderData<typeof loader>();

  const isImage = file.kind === "texture";
  const isModel = file.kind === "model";
  const isAudio = file.kind === "audio";
  const isText = file.kind === "config";

  const displayUrl = getDisplayUrl(file);
  const downloadUrl = `/uploads/${file.path}`;

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          {folder && (
            <>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${folder.slug}`}>{folder.name}</a>
            </>
          )}
          <span className="breadcrumb-sep">/</span>
          <span>{file.name}</span>
        </div>

        <div className="file-detail">
          {/* Preview */}
          <div className="file-preview">
            {isImage && (
              <a href={downloadUrl} target="_blank" rel="noopener">
                <img
                  src={displayUrl}
                  alt={file.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "500px",
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
              </a>
            )}

            {isModel && (
              <div
                style={{
                  height: "400px",
                  background: "#f5f5f5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* TODO: Add model viewer */}
                <div style={{ textAlign: "center", color: "#999" }}>
                  <div style={{ fontSize: "3rem" }}>📦</div>
                  <div>3D Model</div>
                  <a href={downloadUrl} className="btn" style={{ marginTop: "1rem" }}>
                    Download
                  </a>
                </div>
              </div>
            )}

            {isAudio && isWebPlayableAudio(file.name) && (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔊</div>
                <audio controls src={downloadUrl} style={{ width: "100%", maxWidth: "400px" }}>
                  Your browser does not support the audio element.
                </audio>
                <div style={{ marginTop: "1rem" }}>
                  <a href={downloadUrl} className="btn" download>
                    Download
                  </a>
                </div>
              </div>
            )}

            {isAudio && !isWebPlayableAudio(file.name) && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔊</div>
                <div style={{ marginBottom: "0.5rem" }}>{extname(file.name).slice(1).toUpperCase()} Audio</div>
                <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
                  This format cannot be played in the browser
                </div>
                <a href={downloadUrl} className="btn btn-primary" download>
                  Download
                </a>
              </div>
            )}

            {!isImage && !isModel && !isAudio && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
                  {file.kind === "map"
                    ? "🗺️"
                    : file.kind === "archive"
                    ? "📁"
                    : file.kind === "config"
                    ? "📄"
                    : "📎"}
                </div>
                <div style={{ marginBottom: "1rem" }}>{file.kind || "File"}</div>
                <a href={downloadUrl} className="btn btn-primary">
                  Download
                </a>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="file-info card">
            <h2 style={{ fontWeight: 500, marginBottom: "1rem" }}>{file.name}</h2>

            <dl className="detail-info">
              <dt>Kind</dt>
              <dd style={{ textTransform: "capitalize" }}>{file.kind}</dd>

              <dt>Size</dt>
              <dd>{formatSize(file.size)}</dd>

              <dt>Type</dt>
              <dd>{file.mimeType}</dd>

              {file.width && file.height && (
                <>
                  <dt>Dimensions</dt>
                  <dd>
                    {file.width} × {file.height}
                  </dd>

                  <dt>Aspect Ratio</dt>
                  <dd>{getAspectRatio(file.width, file.height)}</dd>
                </>
              )}

              {file.source && (
                <>
                  <dt>Source</dt>
                  <dd>{file.source}</dd>
                </>
              )}

              {file.sourceArchive && (
                <>
                  <dt>Archive</dt>
                  <dd>{file.sourceArchive}</dd>
                </>
              )}

              <dt>Path</dt>
              <dd>
                <code style={{ fontSize: "0.75rem" }}>{file.path}</code>
              </dd>
            </dl>

            {tags.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Tags</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      style={{
                        padding: "0.125rem 0.5rem",
                        background: "#f0f0f0",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: "1.5rem" }}>
              <a href={downloadUrl} className="btn btn-primary" download>
                Download Original
              </a>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .file-detail {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 1.5rem;
        }
        
        @media (max-width: 768px) {
          .file-detail {
            grid-template-columns: 1fr;
          }
        }
        
        .file-preview {
          background: #fafafa;
          border: 1px solid #eee;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 300px;
        }
        
        .file-preview img {
          display: block;
        }
      `}</style>
    </div>
  );
}

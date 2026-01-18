import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/model.$id";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, models, folders, users } from "~/db";
import { eq } from "drizzle-orm";
import { Header } from "~/components/Header";

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const model = await db.query.models.findFirst({
    where: eq(models.id, params.id!),
  });

  if (!model) {
    throw new Response("Model not found", { status: 404 });
  }

  let uploader = null;
  if (model.uploaderId) {
    uploader = await db.query.users.findFirst({
      where: eq(users.id, model.uploaderId),
    });
  }

  let folder = null;
  if (model.folderId) {
    folder = await db.query.folders.findFirst({
      where: eq(folders.id, model.folderId),
    });
  }

  return { user, model, uploader, folder };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.model?.originalName || "Model"} - artbin` }];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function ModelDetail() {
  const { user, model, uploader, folder } = useLoaderData<typeof loader>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/models">Models</a>
          {folder && (
            <>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${folder.slug}`}>{folder.name}</a>
            </>
          )}
          <span className="breadcrumb-sep">/</span>
          <span>{model.originalName}</span>
        </div>

        <div className="detail-grid">
          {/* 3D Viewer */}
          <div>
            <div className="model-viewer-container">
              <model-viewer
                src={`/uploads/${model.filename}`}
                alt={model.originalName}
                camera-controls
                auto-rotate
                shadow-intensity="1"
                style={{
                  width: "100%",
                  height: "400px",
                  backgroundColor: "#f5f5f5",
                  border: "1px solid #000",
                }}
              />
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <a
                href={`/uploads/${model.filename}`}
                download={model.originalName}
                className="btn"
              >
                Download
              </a>
              {model.sourceUrl && (
                <a
                  href={model.sourceUrl}
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
                {model.originalName}
              </h1>
              <dl className="detail-info">
                <dt>Size</dt>
                <dd>{formatBytes(model.size)}</dd>
                
                <dt>Type</dt>
                <dd>{model.mimeType}</dd>
                
                <dt>Source</dt>
                <dd>
                  {uploader
                    ? `@${uploader.username}`
                    : model.source || "Unknown"}
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
          </div>
        </div>
      </main>

      {/* Load model-viewer web component */}
      <script
        type="module"
        src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"
      />
    </div>
  );
}

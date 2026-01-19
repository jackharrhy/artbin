import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders } from "~/db";
import { count } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob } from "~/lib/jobs.server";
import { existsSync } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro game textures",
    url: "https://textures.neocities.org/",
  },
  {
    id: "texture-station",
    name: "Texture Station",
    description: "thejang.com/textures - 392 classic tiling backgrounds from 1996",
    url: "https://thejang.com/textures/",
  },
  {
    id: "sadgrl",
    name: "Sadgrl Tiled Backgrounds",
    description: "sadgrl.online archive - 500+ tiled backgrounds organized by color",
    url: "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  // Get current counts
  const [{ total: fileCount }] = await db.select({ total: count() }).from(files);
  const [{ total: folderCount }] = await db.select({ total: count() }).from(folders);

  return {
    user,
    sources: IMPORT_SOURCES,
    stats: {
      fileCount,
      folderCount,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // TextureTown import
  if (intent === "texturetown") {
    const job = await createJob({
      type: "texturetown-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texturetown" };
  }

  // Texture Station import
  if (intent === "texture-station") {
    const job = await createJob({
      type: "texture-station-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "texture-station" };
  }

  // Sadgrl import
  if (intent === "sadgrl") {
    const job = await createJob({
      type: "sadgrl-import",
      input: { userId: user.id },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "sadgrl" };
  }

  // Folder import
  if (intent === "folder-import") {
    const folderPath = formData.get("folderPath") as string;
    const folderName = formData.get("folderName") as string;
    
    if (!folderPath || !folderPath.trim()) {
      return { error: "Please enter a folder path" };
    }

    // Validate the path exists and is a directory
    if (!existsSync(folderPath)) {
      return { error: `Path does not exist: ${folderPath}` };
    }

    try {
      const stats = await stat(folderPath);
      if (!stats.isDirectory()) {
        return { error: `Path is not a directory: ${folderPath}` };
      }
    } catch {
      return { error: `Cannot access path: ${folderPath}` };
    }

    // Generate slug from folder name or path
    const name = folderName?.trim() || basename(folderPath);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const job = await createJob({
      type: "folder-import",
      input: {
        sourcePath: folderPath,
        targetFolderSlug: slug,
        targetFolderName: name,
        userId: user.id,
      },
      userId: user.id,
    });
    return { success: true, jobId: job.id, action: "folder-import", folderName: name };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Import - Admin - artbin" }];
}

export default function AdminImport() {
  const { user, sources, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "900px" }}>
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          <span className="breadcrumb-sep">/</span>
          <a href="/admin/jobs">Admin</a>
          <span className="breadcrumb-sep">/</span>
          <span>Import</span>
        </div>

        <h1 className="page-title">Import</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.success && actionData.action === "texturetown" && (
          <div className="alert alert-success">
            <p><strong>TextureTown import started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {actionData?.success && actionData.action === "texture-station" && (
          <div className="alert alert-success">
            <p><strong>Texture Station import started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {actionData?.success && actionData.action === "sadgrl" && (
          <div className="alert alert-success">
            <p><strong>Sadgrl Tiled Backgrounds import started!</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {actionData?.success && actionData.action === "folder-import" && (
          <div className="alert alert-success">
            <p><strong>Folder import started: {actionData.folderName}</strong></p>
            <p><a href="/admin/jobs">View job progress</a></p>
          </div>
        )}

        {/* Stats */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Current Stats</h2>
          <dl className="detail-info">
            <dt>Total Files</dt>
            <dd>{stats.fileCount.toLocaleString()}</dd>
            <dt>Total Folders</dt>
            <dd>{stats.folderCount.toLocaleString()}</dd>
          </dl>
        </div>

        {/* Local Folder Import */}
        <section className="section">
          <h2 className="section-title">Local Folder</h2>
          
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
              Import from Folder Path
            </h3>
            <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
              Recursively import all supported files from a local folder (images, audio, models, etc.)
            </p>
            
            <Form method="post">
              <input type="hidden" name="intent" value="folder-import" />
              
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Folder Path
                </label>
                <input
                  type="text"
                  name="folderPath"
                  placeholder="/path/to/game/assets"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ccc",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  }}
                />
              </div>
              
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  Collection Name (optional)
                </label>
                <input
                  type="text"
                  name="folderName"
                  placeholder="Leave blank to use folder name"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ccc",
                    fontSize: "0.875rem",
                  }}
                />
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.75rem", color: "#888" }}>
                  Supports: png, jpg, tga, bmp, wav, ogg, mp3, obj, md5mesh, etc.
                </span>
                <button
                  type="submit"
                  className="btn btn-primary"
                  onClick={(e) => {
                    const form = e.currentTarget.form;
                    const pathInput = form?.querySelector('input[name="folderPath"]') as HTMLInputElement;
                    if (!pathInput?.value.trim()) {
                      e.preventDefault();
                      alert("Please enter a folder path");
                      return;
                    }
                    if (!confirm(`Import all supported files from:\n${pathInput.value}\n\nThis may take a while for large folders.`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Import Folder
                </button>
              </div>
            </Form>
          </div>
        </section>

        {/* Local Archives */}
        <section className="section">
          <h2 className="section-title">Local Archives</h2>
          
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <h3 style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                  Scan & Import Local Archives
                </h3>
                <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
                  Find PAK, PK3, WAD, and ZIP files in game directories on this computer
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <a href="/admin/scan-settings" className="btn">
                  Settings
                </a>
                <a href="/admin/archives" className="btn btn-primary">
                  Browse Archives
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Online Sources */}
        <section className="section">
          <h2 className="section-title">Online Sources</h2>

          {sources.map((source) => (
            <div key={source.id} className="card" style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </h3>
                  <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
                    {source.description}
                  </p>
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value={source.id} />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    onClick={(e) => {
                      if (!confirm(`Start importing from ${source.name}? This may take a while.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Import All
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </section>

        <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#666" }}>
          <a href="/admin/jobs">View Jobs</a> |{" "}
          <a href="/folders">Browse Folders</a>
        </p>
      </main>
    </div>
  );
}

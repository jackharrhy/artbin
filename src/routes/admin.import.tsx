import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders } from "~/db";
import { count } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob } from "~/lib/jobs.server";

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
              <a href="/admin/archives" className="btn btn-primary">
                Browse Archives
              </a>
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

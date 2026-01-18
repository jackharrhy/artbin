import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.import";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders } from "~/db";
import { count, like } from "drizzle-orm";
import { Header } from "~/components/Header";
import { createJob } from "~/lib/jobs.server";

// Register the job handler
import "~/lib/texturetown-job.server";

// Import sources configuration
const IMPORT_SOURCES = [
  {
    id: "texturetown",
    name: "TextureTown",
    description: "textures.neocities.org - 3800+ retro game textures",
    url: "https://textures.neocities.org/",
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

  // Check how many TextureTown files we already have
  const [{ total: textureTownCount }] = await db
    .select({ total: count() })
    .from(files)
    .where(like(files.source, "texturetown%"));

  return {
    user,
    sources: IMPORT_SOURCES,
    stats: {
      fileCount,
      folderCount,
      textureTownCount,
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
  const source = formData.get("source") as string;

  if (source === "texturetown") {
    // Create a background job for TextureTown import
    const job = await createJob({
      type: "texturetown-import",
      input: {
        userId: user.id,
      },
      userId: user.id,
    });

    return { success: true, jobId: job.id };
  }

  return { error: "Unknown import source" };
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
      <main className="main-content" style={{ maxWidth: "800px" }}>
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          <span className="breadcrumb-sep">/</span>
          <a href="/admin/jobs">Admin</a>
          <span className="breadcrumb-sep">/</span>
          <span>Import</span>
        </div>

        <h1 className="page-title">Import Textures</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.success && (
          <div className="alert alert-success">
            <p><strong>Import job started!</strong></p>
            <p>
              <a href="/admin/jobs">View job progress</a>
            </p>
          </div>
        )}

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Current Stats</h2>
          <dl className="detail-info">
            <dt>Total Files</dt>
            <dd>{stats.fileCount.toLocaleString()}</dd>
            <dt>Total Folders</dt>
            <dd>{stats.folderCount.toLocaleString()}</dd>
            <dt>TextureTown Imports</dt>
            <dd>{stats.textureTownCount.toLocaleString()}</dd>
          </dl>
        </div>

        <h2 className="section-title">Import Sources</h2>

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
                <input type="hidden" name="source" value={source.id} />
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

            {source.id === "texturetown" && stats.textureTownCount > 0 && (
              <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.75rem", marginBottom: 0 }}>
                Already imported {stats.textureTownCount.toLocaleString()} textures from TextureTown.
                Running import again will skip existing files.
              </p>
            )}
          </div>
        ))}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#666" }}>
          <a href="/admin/jobs">View Jobs</a> |{" "}
          <a href="/folders">Browse Folders</a>
        </p>
      </main>
    </div>
  );
}

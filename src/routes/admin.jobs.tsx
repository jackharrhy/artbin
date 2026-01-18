import { useLoaderData, redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/admin.jobs";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { getAllJobs } from "~/lib/jobs.server";
import { useEffect } from "react";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/");
  }

  const jobs = await getAllJobs(100);

  return { user, jobs };
}

export function meta() {
  return [{ title: "Jobs - Admin - artbin" }];
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "#d4edda";
    case "failed":
      return "#f8d7da";
    case "running":
      return "#fff3cd";
    case "cancelled":
      return "#e2e3e5";
    default:
      return "#cce5ff";
  }
}

export default function AdminJobs() {
  const { user, jobs } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Auto-refresh every 2 seconds if there are running jobs
  useEffect(() => {
    const hasRunningJobs = jobs.some((j) => j.status === "running" || j.status === "pending");
    
    if (hasRunningJobs) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [jobs, revalidator]);

  return (
    <div>
      <header className="header">
        <a href="/" className="header-logo">
          artbin
        </a>
        <span className="badge-admin">admin</span>
      </header>

      <main className="main-content" style={{ maxWidth: "1000px" }}>
        <h1 className="page-title">Background Jobs</h1>

        {jobs.length === 0 ? (
          <div className="empty-state">No jobs found</div>
        ) : (
          <div className="card" style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #eee" }}>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>ID</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Type</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Status</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Progress</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Created</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  let output: Record<string, unknown> | null = null;
                  try {
                    if (job.output) output = JSON.parse(job.output);
                  } catch {}

                  return (
                    <tr
                      key={job.id}
                      style={{ borderBottom: "1px solid #eee" }}
                    >
                      <td style={{ padding: "0.5rem" }}>
                        <code style={{ fontSize: "0.75rem" }}>{job.id}</code>
                      </td>
                      <td style={{ padding: "0.5rem" }}>{job.type}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <span
                          style={{
                            padding: "0.125rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: getStatusColor(job.status),
                          }}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        {job.status === "running" && (
                          <div>
                            <div
                              style={{
                                width: "100px",
                                height: "6px",
                                background: "#eee",
                                borderRadius: "3px",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${job.progress || 0}%`,
                                  height: "100%",
                                  background: "#4CAF50",
                                  transition: "width 0.3s",
                                }}
                              />
                            </div>
                            <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                              {job.progressMessage || `${job.progress || 0}%`}
                            </div>
                          </div>
                        )}
                        {job.status === "completed" && output && (
                          <span style={{ fontSize: "0.75rem" }}>
                            {(output as any).totalFiles} files
                          </span>
                        )}
                        {job.status === "failed" && (
                          <span
                            style={{ fontSize: "0.75rem", color: "#dc3545" }}
                            title={job.error || "Unknown error"}
                          >
                            {job.error?.substring(0, 50)}
                            {(job.error?.length || 0) > 50 ? "..." : ""}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>
                        {formatDate(job.createdAt)}
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>
                        {formatDate(job.completedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <a href="/admin/extract">Extract Archive</a> |{" "}
          <a href="/folders">Folders</a> |{" "}
          <a href="/settings">Settings</a>
        </p>
      </main>
    </div>
  );
}

import { useLoaderData, redirect, useRevalidator, Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.jobs";
import { Result } from "better-result";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { getAllJobs, deleteJob, cancelJob, resetStuckJob, isJobStuck } from "~/lib/jobs.server";
import { useEffect } from "react";

const STUCK_THRESHOLD_MINUTES = 30;

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

  // Add stuck status to each job
  const jobsWithStatus = jobs.map((job) => ({
    ...job,
    isStuck: isJobStuck(job, STUCK_THRESHOLD_MINUTES),
  }));

  return { user, jobs: jobsWithStatus };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const jobId = formData.get("jobId") as string;

  if (!jobId) {
    return { error: "Missing job ID" };
  }

  switch (intent) {
    case "delete":
      await deleteJob(jobId);
      return { success: true, action: "deleted" };

    case "cancel":
      const cancel = await cancelJob(jobId);
      if (Result.isError(cancel)) {
        return { error: cancel.error.message };
      }
      return { success: true, action: "cancelled" };

    case "reset":
      const reset = await resetStuckJob(jobId, STUCK_THRESHOLD_MINUTES);
      if (Result.isError(reset)) {
        return { error: reset.error.message };
      }
      return { success: true, action: "reset" };

    default:
      return { error: "Unknown action" };
  }
}

export function meta() {
  return [{ title: "Jobs - Admin - artbin" }];
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function formatDuration(startDate: Date | null): string {
  if (!startDate) return "-";
  const start = new Date(startDate).getTime();
  const now = Date.now();
  const diffMs = now - start;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getStatusColor(status: string, isStuck: boolean): string {
  if (isStuck) return "#f8d7da"; // Red for stuck
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
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Auto-refresh every 2 seconds if there are running or pending jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some((j) => j.status === "running" || j.status === "pending");

    if (hasActiveJobs) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [jobs, revalidator]);

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "pending");
  const completedJobs = jobs.filter((j) => j.status !== "running" && j.status !== "pending");

  return (
    <div>
      <header className="header">
        <a href="/" className="header-logo">
          artbin
        </a>
        <span className="badge-admin">admin</span>
      </header>

      <main className="main-content" style={{ maxWidth: "1100px" }}>
        <h1 className="page-title">Background Jobs</h1>

        {activeJobs.length > 0 && (
          <div style={{ marginBottom: "0.5rem", fontSize: "0.875rem", color: "#666" }}>
            Auto-refreshing... {activeJobs.length} active job(s)
          </div>
        )}

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
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Duration</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Created</th>
                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  let output: Record<string, unknown> | null = null;
                  try {
                    if (job.output) output = JSON.parse(job.output);
                  } catch {}

                  const canCancel = job.status === "pending";
                  const canReset = job.status === "running" && job.isStuck;
                  const canDelete = job.status !== "running" || job.isStuck;

                  return (
                    <tr
                      key={job.id}
                      style={{
                        borderBottom: "1px solid #eee",
                        background: job.isStuck ? "#fff5f5" : undefined,
                      }}
                    >
                      <td style={{ padding: "0.5rem" }}>
                        <code style={{ fontSize: "0.75rem" }}>{job.id.slice(0, 8)}...</code>
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.875rem" }}>{job.type}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <span
                          style={{
                            padding: "0.125rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: getStatusColor(job.status, job.isStuck),
                          }}
                        >
                          {job.isStuck ? "stuck" : job.status}
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
                                  background: job.isStuck ? "#dc3545" : "#4CAF50",
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
                            {(output as any).totalFiles ?? (output as any).categoriesImported?.length ?? "-"} files
                          </span>
                        )}
                        {job.status === "failed" && (
                          <span
                            style={{ fontSize: "0.75rem", color: "#dc3545" }}
                            title={job.error || "Unknown error"}
                          >
                            {job.error?.substring(0, 40)}
                            {(job.error?.length || 0) > 40 ? "..." : ""}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>
                        {job.status === "running" && (
                          <span style={{ color: job.isStuck ? "#dc3545" : undefined }}>
                            {formatDuration(job.startedAt)}
                            {job.isStuck && " (stuck!)"}
                          </span>
                        )}
                        {job.status === "completed" && job.startedAt && job.completedAt && (
                          <span>
                            {formatDuration(job.startedAt).replace(/s$/, "")}
                          </span>
                        )}
                        {job.status === "pending" && <span style={{ color: "#999" }}>waiting</span>}
                        {(job.status === "failed" || job.status === "cancelled") && "-"}
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.75rem" }}>
                        {formatDate(job.createdAt)}
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          {canCancel && (
                            <Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="cancel" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button
                                type="submit"
                                className="btn btn-sm"
                                disabled={isSubmitting}
                              >
                                Cancel
                              </button>
                            </Form>
                          )}
                          {canReset && (
                            <Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="reset" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button
                                type="submit"
                                className="btn btn-sm"
                                disabled={isSubmitting}
                                title="Reset stuck job back to pending"
                              >
                                Reset
                              </button>
                            </Form>
                          )}
                          {canDelete && (
                            <Form method="post" style={{ display: "inline" }}>
                              <input type="hidden" name="intent" value="delete" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button
                                type="submit"
                                className="btn btn-sm btn-danger"
                                disabled={isSubmitting}
                                onClick={(e) => {
                                  if (!confirm("Delete this job?")) {
                                    e.preventDefault();
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </Form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <a href="/admin/import">Import</a> |{" "}
          <a href="/upload">Upload</a> |{" "}
          <a href="/folders">Folders</a> |{" "}
          <a href="/settings">Settings</a>
        </p>
      </main>
    </div>
  );
}

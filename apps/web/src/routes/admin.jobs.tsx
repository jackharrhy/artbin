import { useLoaderData, redirect, useRevalidator, Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.jobs";
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
      if (cancel.isErr()) {
        return { error: cancel.error.message };
      }
      return { success: true, action: "cancelled" };

    case "reset":
      const reset = await resetStuckJob(jobId, STUCK_THRESHOLD_MINUTES);
      if (reset.isErr()) {
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

function getStatusBadgeClass(status: string, isStuck: boolean): string {
  if (isStuck) return "bg-[#f8d7da]";
  switch (status) {
    case "completed":
      return "bg-[#d4edda]";
    case "failed":
      return "bg-[#f8d7da]";
    case "running":
      return "bg-[#fff3cd]";
    case "cancelled":
      return "bg-[#e2e3e5]";
    default:
      return "bg-[#cce5ff]";
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
    <main className="max-w-[1100px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
        <h1 className="text-xl font-normal mb-4 pb-2 border-b border-border-light">
          Background Jobs
        </h1>

        {activeJobs.length > 0 && (
          <div className="mb-2 text-sm text-text-muted">
            Auto-refreshing... {activeJobs.length} active job(s)
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="text-center p-12 text-text-muted">No jobs found</div>
        ) : (
          <div className="card overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-bg-subtle">
                  <th className="p-2 text-left">ID</th>
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Progress</th>
                  <th className="p-2 text-left">Duration</th>
                  <th className="p-2 text-left">Created</th>
                  <th className="p-2 text-left">Actions</th>
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
                      className={`border-b border-bg-subtle ${job.isStuck ? "bg-[#fff5f5]" : ""}`}
                    >
                      <td className="p-2">
                        <code className="text-xs">{job.id.slice(0, 8)}...</code>
                      </td>
                      <td className="p-2 text-sm">{job.type}</td>
                      <td className="p-2">
                        <span
                          className={`px-2 py-0.5 text-xs ${getStatusBadgeClass(job.status, job.isStuck)}`}
                        >
                          {job.isStuck ? "stuck" : job.status}
                        </span>
                      </td>
                      <td className="p-2">
                        {job.status === "running" && (
                          <div>
                            <div className="w-[100px] h-1.5 bg-bg-subtle overflow-hidden">
                              <div
                                className={`h-full transition-[width] duration-300 ${job.isStuck ? "bg-[#dc3545]" : "bg-[#4CAF50]"}`}
                                style={{ width: `${job.progress || 0}%` }}
                              />
                            </div>
                            <div className="text-xs mt-1">
                              {job.progressMessage || `${job.progress || 0}%`}
                            </div>
                          </div>
                        )}
                        {job.status === "completed" && output && (
                          <span className="text-xs">
                            {(output as any).totalFiles ??
                              (output as any).categoriesImported?.length ??
                              "-"}{" "}
                            files
                          </span>
                        )}
                        {job.status === "failed" && (
                          <span
                            className="text-xs text-[#dc3545]"
                            title={job.error || "Unknown error"}
                          >
                            {job.error?.substring(0, 40)}
                            {(job.error?.length || 0) > 40 ? "..." : ""}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {job.status === "running" && (
                          <span className={job.isStuck ? "text-[#dc3545]" : ""}>
                            {formatDuration(job.startedAt)}
                            {job.isStuck && " (stuck!)"}
                          </span>
                        )}
                        {job.status === "completed" && job.startedAt && job.completedAt && (
                          <span>{formatDuration(job.startedAt).replace(/s$/, "")}</span>
                        )}
                        {job.status === "pending" && (
                          <span className="text-text-faint">waiting</span>
                        )}
                        {(job.status === "failed" || job.status === "cancelled") && "-"}
                      </td>
                      <td className="p-2 text-xs">{formatDate(job.createdAt)}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {canCancel && (
                            <Form method="post" className="inline">
                              <input type="hidden" name="intent" value="cancel" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button type="submit" className="btn btn-sm" disabled={isSubmitting}>
                                Cancel
                              </button>
                            </Form>
                          )}
                          {canReset && (
                            <Form method="post" className="inline">
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
                            <Form method="post" className="inline">
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

        <p className="mt-8 text-sm">
          <a href="/admin/import">Import</a> | <a href="/upload">Upload</a> |{" "}
          <a href="/folders">Folders</a> | <a href="/settings">Settings</a>
        </p>
    </main>
  );
}

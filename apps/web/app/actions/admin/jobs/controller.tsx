import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { cancelJob, deleteJob, getAllJobs, isJobStuck, resetStuckJob } from "#lib/jobs.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { AutoRefresh } from "../../../ui/public/auto-refresh.tsx";

const stuckThresholdMinutes = 30;

export default createController(routes.admin.jobs, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const jobs = (await getAllJobs(100)).map((job) => ({
        ...job,
        isStuck: isJobStuck(job, stuckThresholdMinutes),
      }));
      const active = jobs.some((job) => job.status === "running" || job.status === "pending");

      return context.render(
        <AdminPage user={context.user} active="jobs" title="Jobs">
          <AutoRefresh active={active} />
          {active ? (
            <p className="mb-2 text-sm text-text-muted">Active jobs refresh every two seconds.</p>
          ) : null}
          {jobs.length ? (
            <JobsTable jobs={jobs} />
          ) : (
            <p className="text-text-muted">No jobs found.</p>
          )}
        </AdminPage>,
      );
    },

    async action(context) {
      const form = await context.request.formData();
      const intent = form.get("intent");
      const jobId = form.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return new Response("Missing job ID", { status: 400 });
      }

      if (intent === "delete") await deleteJob(jobId);
      else if (intent === "cancel") {
        const result = await cancelJob(jobId);
        if (result.isErr()) return new Response(result.error.message, { status: 409 });
      } else if (intent === "reset") {
        const result = await resetStuckJob(jobId, stuckThresholdMinutes);
        if (result.isErr()) return new Response(result.error.message, { status: 409 });
      } else {
        return new Response("Unknown job action", { status: 400 });
      }
      return redirect(routes.admin.jobs.index.href(), 303);
    },
  },
});

type AdminJob = Awaited<ReturnType<typeof getAllJobs>>[number] & { isStuck: boolean };

function JobsTable(handle: { props: { jobs: AdminJob[] } }) {
  return () => (
    <div className="card overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-bg-subtle text-left">
            <th className="p-2">ID</th>
            <th className="p-2">Type</th>
            <th className="p-2">Status</th>
            <th className="p-2">Progress</th>
            <th className="p-2">Created</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.jobs.map((job) => (
            <tr key={job.id} className="border-b border-bg-subtle">
              <td className="p-2">
                <code className="text-xs">{job.id.slice(0, 8)}...</code>
              </td>
              <td className="p-2 text-sm">{job.type}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 text-xs ${statusClass(job.status, job.isStuck)}`}>
                  {job.isStuck ? "stuck" : job.status}
                </span>
              </td>
              <td className="p-2 text-xs max-w-[260px]">
                {job.status === "running" ? (
                  <>
                    <div className="w-[100px] h-1.5 bg-bg-subtle overflow-hidden">
                      <div
                        className="h-full bg-[#4CAF50]"
                        style={{ width: `${job.progress ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-1 truncate">
                      {job.progressMessage ?? `${job.progress ?? 0}%`}
                    </div>
                  </>
                ) : job.status === "failed" ? (
                  <span className="text-danger" title={job.error ?? undefined}>
                    {job.error?.slice(0, 60) ?? "Failed"}
                  </span>
                ) : (
                  job.status
                )}
              </td>
              <td className="p-2 text-xs">{formatDate(job.createdAt)}</td>
              <td className="p-2">
                <div className="flex gap-1">
                  {job.status === "pending" ? <JobForm jobId={job.id} intent="cancel" /> : null}
                  {job.status === "running" && job.isStuck ? (
                    <JobForm jobId={job.id} intent="reset" />
                  ) : null}
                  {job.status !== "running" || job.isStuck ? (
                    <JobForm jobId={job.id} intent="delete" danger />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobForm(handle: { props: { jobId: string; intent: string; danger?: boolean } }) {
  return () => (
    <form method="post" action={routes.admin.jobs.action.href()}>
      <input type="hidden" name="jobId" value={handle.props.jobId} />
      <button
        type="submit"
        name="intent"
        value={handle.props.intent}
        className={`btn btn-sm ${handle.props.danger ? "btn-danger" : ""}`}
      >
        {handle.props.intent[0]!.toUpperCase() + handle.props.intent.slice(1)}
      </button>
    </form>
  );
}

function statusClass(status: string, stuck: boolean): string {
  if (stuck || status === "failed") return "bg-[#f8d7da]";
  if (status === "completed") return "bg-[#d4edda]";
  if (status === "running") return "bg-[#fff3cd]";
  if (status === "cancelled") return "bg-[#e2e3e5]";
  return "bg-[#cce5ff]";
}

function formatDate(value: Date | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

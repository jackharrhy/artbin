import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.scan-settings";
import { userContext } from "~/lib/auth-context.server";
import {
  initializeScanSettings,
  updateScanSettings,
  resetScanSettings,
  type ScanSettings,
} from "~/lib/settings.server";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  const settings = await initializeScanSettings();

  return {
    user,
    settings,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "reset") {
    await resetScanSettings();
    return { success: true, message: "Settings reset to defaults" };
  }

  if (intent === "save") {
    // Parse the textarea values (one item per line)
    const excludeDirs = ((formData.get("excludeDirs") as string) || "").split("\n").flatMap((s) => {
      const trimmed = s.trim();
      return trimmed ? [trimmed] : [];
    });

    const excludeFilenames = ((formData.get("excludeFilenames") as string) || "")
      .split("\n")
      .flatMap((s) => {
        const trimmed = s.trim();
        return trimmed ? [trimmed] : [];
      });

    const excludePathPatterns = ((formData.get("excludePathPatterns") as string) || "")
      .split("\n")
      .flatMap((s) => {
        const trimmed = s.trim();
        return trimmed ? [trimmed] : [];
      });

    const knownGameDirs = ((formData.get("knownGameDirs") as string) || "")
      .split("\n")
      .flatMap((s) => {
        const trimmed = s.trim();
        return trimmed ? [trimmed] : [];
      });

    const result = await updateScanSettings({
      excludeDirs,
      excludeFilenames,
      excludePathPatterns,
      knownGameDirs,
    });

    if (result.isErr()) {
      return { error: result.error.message };
    }

    return { success: true, message: "Settings saved" };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Scan settings - Admin - artbin" }];
}

export default function AdminScanSettings() {
  const { user, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <p className="mb-6 text-text-muted">
        Choose which files and directories the archive scanner includes or skips.
      </p>

      {actionData?.error && <div className="alert alert-error mb-4">{actionData.error}</div>}

      {actionData?.success && <div className="alert alert-success mb-4">{actionData.message}</div>}

      <Form method="post">
        <input type="hidden" name="intent" value="save" />

        <div className="card mb-6">
          <div className="mb-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
              Excluded directories
            </label>
            <p className="text-xs text-text-muted mb-2">
              Skip these directories wherever they appear in a path. Enter one per line.
            </p>
            <textarea
              name="excludeDirs"
              className="input w-full min-h-[200px] font-mono text-[0.8125rem]"
              defaultValue={settings.excludeDirs.join("\n")}
            />
          </div>
        </div>

        <div className="card mb-6">
          <div className="mb-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
              Excluded filenames
            </label>
            <p className="text-xs text-text-muted mb-2">
              Always skip these exact filenames, regardless of case. Enter one per line.
            </p>
            <textarea
              name="excludeFilenames"
              className="input w-full min-h-[120px] font-mono text-[0.8125rem]"
              defaultValue={settings.excludeFilenames.join("\n")}
            />
          </div>
        </div>

        <div className="card mb-6">
          <div className="mb-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
              Excluded path patterns
            </label>
            <p className="text-xs text-text-muted mb-2">
              Skip paths that match these regular expressions. Enter one per line. Matching ignores
              case.
            </p>
            <textarea
              name="excludePathPatterns"
              className="input w-full min-h-[120px] font-mono text-[0.8125rem]"
              defaultValue={settings.excludePathPatterns.join("\n")}
            />
          </div>
        </div>

        <div className="card mb-6">
          <div className="mb-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-text-muted mb-1">
              Known game directories
            </label>
            <p className="text-xs text-text-muted mb-2">
              These directory names identify game content. The scanner only includes ZIP files found
              in one of them.
            </p>
            <textarea
              name="knownGameDirs"
              className="input w-full min-h-[150px] font-mono text-[0.8125rem]"
              defaultValue={settings.knownGameDirs.join("\n")}
            />
          </div>
        </div>

        <div className="flex gap-3 mb-8">
          <button type="submit" className="btn btn-primary">
            Save settings
          </button>
          <button
            type="submit"
            name="intent"
            value="reset"
            className="btn"
            onClick={(e) => {
              if (!confirm("Reset all scan settings to defaults? This cannot be undone.")) {
                e.preventDefault();
              }
            }}
          >
            Reset to defaults
          </button>
        </div>
      </Form>
    </div>
  );
}

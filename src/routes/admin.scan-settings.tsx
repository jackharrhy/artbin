import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.scan-settings";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { Header } from "~/components/Header";
import type { ScanSettings } from "~/lib/settings.types";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/folders");
  }

  // Import server module inside loader
  const { initializeScanSettings } = await import("~/lib/settings.server");
  
  // Initialize settings if they don't exist, then get them
  const settings = await initializeScanSettings();

  return {
    user,
    settings,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  // Import server module inside action
  const { updateScanSettings, resetScanSettings } = await import("~/lib/settings.server");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "reset") {
    await resetScanSettings();
    return { success: true, message: "Settings reset to defaults" };
  }

  if (intent === "save") {
    // Parse the textarea values (one item per line)
    const excludeDirs = (formData.get("excludeDirs") as string || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    
    const excludeFilenames = (formData.get("excludeFilenames") as string || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    
    const excludePathPatterns = (formData.get("excludePathPatterns") as string || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    
    const knownGameDirs = (formData.get("knownGameDirs") as string || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);

    // Validate regex patterns
    const invalidPatterns: string[] = [];
    for (const pattern of excludePathPatterns) {
      try {
        new RegExp(pattern);
      } catch {
        invalidPatterns.push(pattern);
      }
    }

    if (invalidPatterns.length > 0) {
      return { 
        error: `Invalid regex patterns: ${invalidPatterns.join(", ")}`,
      };
    }

    await updateScanSettings({
      excludeDirs,
      excludeFilenames,
      excludePathPatterns,
      knownGameDirs,
    });

    return { success: true, message: "Settings saved" };
  }

  return { error: "Unknown action" };
}

export function meta() {
  return [{ title: "Scan Settings - Admin - artbin" }];
}

export default function AdminScanSettings() {
  const { user, settings } = useLoaderData<typeof loader>();
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
          <a href="/admin/import">Import</a>
          <span className="breadcrumb-sep">/</span>
          <span>Scan Settings</span>
        </div>

        <h1 className="page-title">Archive Scan Settings</h1>
        <p style={{ marginBottom: "1.5rem", color: "#666" }}>
          Configure which files and directories are included or excluded when scanning for game archives.
        </p>

        {actionData?.error && (
          <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div className="alert alert-success" style={{ marginBottom: "1rem" }}>
            {actionData.message}
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="save" />

          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="form-group">
              <label className="form-label">Excluded Directories</label>
              <p className="form-help" style={{ marginBottom: "0.5rem" }}>
                Directories to skip during scanning. One per line. Matches anywhere in the path.
              </p>
              <textarea
                name="excludeDirs"
                className="input"
                style={{ width: "100%", minHeight: "200px", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                defaultValue={settings.excludeDirs.join("\n")}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="form-group">
              <label className="form-label">Excluded Filenames</label>
              <p className="form-help" style={{ marginBottom: "0.5rem" }}>
                Exact filenames to always skip (case-insensitive). One per line.
              </p>
              <textarea
                name="excludeFilenames"
                className="input"
                style={{ width: "100%", minHeight: "120px", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                defaultValue={settings.excludeFilenames.join("\n")}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="form-group">
              <label className="form-label">Excluded Path Patterns</label>
              <p className="form-help" style={{ marginBottom: "0.5rem" }}>
                Regex patterns for paths to skip. One per line. Case-insensitive matching.
              </p>
              <textarea
                name="excludePathPatterns"
                className="input"
                style={{ width: "100%", minHeight: "120px", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                defaultValue={settings.excludePathPatterns.join("\n")}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="form-group">
              <label className="form-label">Known Game Directories</label>
              <p className="form-help" style={{ marginBottom: "0.5rem" }}>
                Directory names that indicate game content. ZIP files are only included if found in one of these directories.
              </p>
              <textarea
                name="knownGameDirs"
                className="input"
                style={{ width: "100%", minHeight: "150px", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                defaultValue={settings.knownGameDirs.join("\n")}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
            <button type="submit" className="btn btn-primary">
              Save Settings
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
              Reset to Defaults
            </button>
          </div>
        </Form>

        <p style={{ fontSize: "0.875rem", color: "#666" }}>
          <a href="/admin/import">← Back to Import</a> |{" "}
          <a href="/admin/archives">Browse Archives</a>
        </p>
      </main>
    </div>
  );
}

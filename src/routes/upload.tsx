import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/upload";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, files } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Header } from "~/components/Header";
import {
  saveFile,
  getMimeType,
  detectKind,
  processImage,
  isImageKind,
} from "~/lib/files.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get all folders for dropdown
  const allFolders = await db.query.folders.findMany({
    orderBy: [folders.slug],
  });

  return { user, folders: allFolders };
}

interface ActionResult {
  error?: string;
  success?: {
    fileId: string;
    filePath: string;
    fileName: string;
  };
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return { error: "Not authenticated" };
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const folderId = formData.get("folderId") as string | null;

  if (!file || file.size === 0) {
    return { error: "No file selected" };
  }

  if (!folderId) {
    return { error: "Please select a folder" };
  }

  // Get folder
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return { error: "Folder not found" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Save file to disk
    const { path: filePath, name: savedName } = await saveFile(
      buffer,
      folder.slug,
      file.name,
      true // overwrite
    );

    // Detect kind and mime type
    const kind = detectKind(savedName);
    const mimeType = await getMimeType(savedName, buffer);

    // Process images
    let width: number | null = null;
    let height: number | null = null;
    let hasPreview = false;

    if (isImageKind(kind)) {
      const imageInfo = await processImage(filePath);
      width = imageInfo.width;
      height = imageInfo.height;
      hasPreview = imageInfo.hasPreview;
    }

    // Create file record
    const fileId = nanoid();
    await db.insert(files).values({
      id: fileId,
      path: filePath,
      name: savedName,
      mimeType,
      size: buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: folder.id,
      uploaderId: user.id,
      source: "upload",
    });

    return {
      success: {
        fileId,
        filePath,
        fileName: savedName,
      },
    };
  } catch (err) {
    console.error("Upload error:", err);
    return { error: `Upload failed: ${err}` };
  }
}

export function meta() {
  return [{ title: "Upload - artbin" }];
}

export default function Upload() {
  const { user, folders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "600px" }}>
        <h1 className="page-title">Upload File</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.success && (
          <div className="alert alert-success">
            <p>
              <strong>File uploaded!</strong>
            </p>
            <p>{actionData.success.fileName}</p>
            <p>
              <a href={`/file/${actionData.success.filePath}`}>View file</a>
            </p>
          </div>
        )}

        <Form method="post" encType="multipart/form-data">
          <div className="card">
            <div className="form-group">
              <label className="form-label">File</label>
              <input
                type="file"
                name="file"
                className="input"
                style={{ width: "100%" }}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Folder</label>
              <select name="folderId" className="input" style={{ width: "100%" }} required>
                <option value="">Select a folder...</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.slug}
                  </option>
                ))}
              </select>
              <p className="form-help">
                Don't see your folder?{" "}
                <a href="/admin/extract">Create one by extracting an archive</a>
              </p>
            </div>

            <button type="submit" className="btn btn-primary">
              Upload
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}

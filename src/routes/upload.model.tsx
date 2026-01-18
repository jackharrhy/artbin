import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/upload.model";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, models } from "~/db";
import { nanoid } from "nanoid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { Header } from "~/components/Header";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const allFolders = await db.query.folders.findMany({
    orderBy: [folders.name],
  });

  return { user, folders: allFolders };
}

export async function action({ request }: Route.ActionArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const file = formData.get("file") as File;
  const folderId = formData.get("folderId") as string | null;

  if (!file || file.size === 0) {
    return { error: "Please select a file" };
  }

  // Check file extension since MIME types for GLTF/GLB can vary
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["gltf", "glb"].includes(ext)) {
    return { error: "Only GLTF and GLB files are allowed" };
  }

  const mimeType = ext === "glb" ? "model/gltf-binary" : "model/gltf+json";
  const filename = `${nanoid()}.${ext}`;

  const uploadsDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(uploadsDir, filename), buffer);

  const [newModel] = await db.insert(models).values({
    id: nanoid(),
    filename,
    originalName: file.name,
    mimeType,
    size: file.size,
    folderId: folderId || null,
    uploaderId: user.id,
  }).returning();

  return redirect(`/model/${newModel.id}`);
}

export function meta() {
  return [{ title: "Upload Model - artbin" }];
}

export default function UploadModel() {
  const { user, folders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Header user={user} />
      <main className="main-content" style={{ maxWidth: "480px" }}>
        <h1 className="page-title">Upload Model</h1>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        <Form method="post" encType="multipart/form-data">
          <div className="form-group">
            <label htmlFor="file" className="form-label">File</label>
            <input
              type="file"
              id="file"
              name="file"
              accept=".gltf,.glb"
              required
              className="input"
              style={{ width: "100%" }}
            />
            <div className="form-help">GLTF or GLB format</div>
          </div>

          <div className="form-group">
            <label htmlFor="folderId" className="form-label">Folder (optional)</label>
            <select
              id="folderId"
              name="folderId"
              className="input"
              style={{ width: "100%" }}
            >
              <option value="">None</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.slug}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary">
            Upload
          </button>
        </Form>
      </main>
    </div>
  );
}

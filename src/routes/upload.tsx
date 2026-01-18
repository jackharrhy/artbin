import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/upload";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, folders, textures } from "~/db";
import { eq, desc, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { Header } from "~/components/Header";
import { getMimeType, processTextureUpload } from "~/lib/images.server";

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  // Get folders for selection
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
  const isSeamless = formData.get("isSeamless") === "on";

  if (!file || file.size === 0) {
    return { error: "Please select a file" };
  }

  // Check file extension for allowed formats
  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowedExts = ["png", "jpg", "jpeg", "gif", "webp", "tga", "pcx", "bmp"];
  if (!ext || !allowedExts.includes(ext)) {
    return { error: "Only PNG, JPEG, GIF, WebP, TGA, PCX, and BMP files are allowed" };
  }

  const filename = `${nanoid()}.${ext}`;
  const mimeType = getMimeType(file.name);

  const uploadsDir = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(uploadsDir, filename), buffer);

  // Process the upload (convert legacy formats, get dimensions)
  const { previewFilename, width, height } = await processTextureUpload(uploadsDir, filename);

  const [newTexture] = await db.insert(textures).values({
    id: nanoid(),
    filename,
    originalName: file.name,
    mimeType,
    size: file.size,
    width,
    height,
    previewFilename,
    isSeamless,
    folderId: folderId || null,
    uploaderId: user.id,
  }).returning();

  return redirect(`/texture/${newTexture.id}`);
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
      <main className="main-content" style={{ maxWidth: "480px" }}>
        <h1 className="page-title">Upload</h1>

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
              accept="image/png,image/jpeg,image/gif,image/webp,.tga,.pcx,.bmp"
              required
              className="input"
              style={{ width: "100%" }}
            />
            <div className="form-help">PNG, JPEG, GIF, WebP, TGA, PCX, or BMP</div>
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

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                name="isSeamless"
              />
              <span>Seamless / Tileable</span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            Upload
          </button>
        </Form>
      </main>
    </div>
  );
}

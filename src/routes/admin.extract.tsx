import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/admin.extract";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, textures, folders } from "~/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join, basename } from "path";
import {
  parseGameFile,
  extractPakEntry,
  extractPk3Entry,
  extractBspTexture,
  miptexToPng,
  filterTextureEntries,
  isTextureEntry,
  isBspEntry,
  filterBspEntries,
  parseBspBuffer,
  extractBspTextureFromBuffer,
  parseWalBuffer,
  isWalEntry,
  filterWalEntries,
  type ParsedBspFile,
} from "~/lib/gamefiles.server";
import { convertToPng, getImageDimensions } from "~/lib/images.server";

const TEMP_DIR = join(process.cwd(), "tmp", "uploads");
const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

export async function loader({ request }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

  if (!user.isAdmin) {
    return redirect("/textures");
  }

  return { user };
}

interface ExtractResult {
  error?: string;
  parsed?: {
    type: string;
    tempFile: string; // Filename of temp file for import step
    entries: Array<{ name: string; size: number; isTexture: boolean; isBsp: boolean }>;
    totalEntries: number;
    textureEntries: number;
    bspEntries: number; // BSP files inside PAK/PK3
  };
  imported?: {
    count: number;
    folderName: string;
    folderSlug: string;
  };
}

export async function action({ request }: Route.ActionArgs): Promise<ExtractResult> {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user || !user.isAdmin) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "upload") {
    return handleUpload(formData);
  } else if (actionType === "import") {
    return handleImport(formData);
  }

  return { error: "Unknown action" };
}

async function handleUpload(formData: FormData): Promise<ExtractResult> {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return { error: "No file uploaded" };
  }

  // Validate file extension
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["pak", "pk3", "bsp", "wad"].includes(ext)) {
    return { error: "Unsupported file type. Supported: PAK, PK3, BSP, WAD" };
  }

  try {
    // Save to temp directory
    await mkdir(TEMP_DIR, { recursive: true });
    const tempFilename = `${nanoid()}_${file.name}`;
    const tempPath = join(TEMP_DIR, tempFilename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    // Parse the file
    const parsed = await parseGameFile(tempPath);

    // Get texture entries
    const textureEntries =
      parsed.type === "bsp"
        ? parsed.entries // BSP entries are all textures
        : filterTextureEntries(parsed.entries);
    
    // Get BSP entries (only for PAK/PK3)
    const bspEntries =
      parsed.type === "bsp" ? [] : filterBspEntries(parsed.entries);

    // Return parsed info for preview
    return {
      parsed: {
        type: parsed.type,
        tempFile: tempFilename,
        entries: parsed.entries.slice(0, 100).map((e) => ({
          name: e.name,
          size: e.size,
          isTexture: parsed.type === "bsp" || isTextureEntry(e),
          isBsp: isBspEntry(e),
        })),
        totalEntries: parsed.entries.length,
        textureEntries: textureEntries.length,
        bspEntries: bspEntries.length,
      },
    };
  } catch (err) {
    return { error: `Failed to parse file: ${err}` };
  }
}

async function handleImport(formData: FormData): Promise<ExtractResult> {
  const tempFile = formData.get("tempFile") as string;
  const folderName = formData.get("folderName") as string;
  const fileType = formData.get("fileType") as string;

  if (!tempFile || !folderName) {
    return { error: "Missing required fields" };
  }

  // Validate tempFile is just a filename (security)
  if (tempFile.includes("/") || tempFile.includes("\\") || tempFile.includes("..")) {
    return { error: "Invalid file reference" };
  }

  const tempPath = join(TEMP_DIR, tempFile);

  try {
    // Parse file again
    const parsed = await parseGameFile(tempPath);

    // Create folder for these textures
    const folderSlug = folderName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    let folder = await db.query.folders.findFirst({
      where: eq(folders.slug, folderSlug),
    });

    if (!folder) {
      const [newFolder] = await db
        .insert(folders)
        .values({
          id: nanoid(),
          name: folderName,
          slug: folderSlug,
          description: `Extracted from ${fileType.toUpperCase()} file`,
          ownerId: null,
          visibility: "public",
          source: `extracted-${fileType}`,
        })
        .returning();
      folder = newFolder;
    }

    const folderId = folder.id; // Capture for closure

    await mkdir(UPLOADS_DIR, { recursive: true });

    let importedCount = 0;
    
    // Legacy formats that need conversion to PNG
    const LEGACY_FORMATS = ["tga", "pcx", "bmp"];

    // Helper to save a texture with optional conversion
    async function saveTexture(
      imageBuffer: Buffer,
      filename: string,
      originalName: string,
      mimeType: string,
      source: string,
      width?: number | null,
      height?: number | null
    ) {
      await writeFile(join(UPLOADS_DIR, filename), imageBuffer);
      await db.insert(textures).values({
        id: nanoid(),
        filename,
        originalName,
        mimeType,
        size: imageBuffer.length,
        width: width ?? null,
        height: height ?? null,
        folderId,
        uploaderId: null,
        source,
      });
      importedCount++;
    }
    
    // Helper to convert legacy format to PNG
    async function convertLegacyFormat(
      imageBuffer: Buffer,
      entryExt: string
    ): Promise<{ buffer: Buffer; filename: string; mimeType: string; width: number | null; height: number | null }> {
      // Save original to temp file
      const tempId = nanoid();
      const tempOriginal = join(TEMP_DIR, `${tempId}.${entryExt}`);
      const tempPng = join(TEMP_DIR, `${tempId}.png`);
      
      await writeFile(tempOriginal, imageBuffer);
      
      // Convert to PNG using ImageMagick
      const success = await convertToPng(tempOriginal, tempPng);
      
      if (success) {
        const { readFile: fsReadFile } = await import("fs/promises");
        const pngBuffer = await fsReadFile(tempPng);
        const dims = await getImageDimensions(tempPng);
        
        // Clean up temp files
        try {
          await unlink(tempOriginal);
          await unlink(tempPng);
        } catch { /* ignore cleanup errors */ }
        
        return {
          buffer: pngBuffer,
          filename: `${nanoid()}.png`,
          mimeType: "image/png",
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        };
      }
      
      // Fallback: keep original if conversion fails
      try { await unlink(tempOriginal); } catch { /* ignore */ }
      return {
        buffer: imageBuffer,
        filename: `${nanoid()}.${entryExt}`,
        mimeType: getMimeType(entryExt),
        width: null,
        height: null,
      };
    }

    // Get texture entries to import
    const textureEntries =
      parsed.type === "bsp" ? parsed.entries : filterTextureEntries(parsed.entries);

    // Get BSP entries (for PAK/PK3 only)
    const bspEntries =
      parsed.type === "bsp" ? [] : filterBspEntries(parsed.entries);

    // Import direct texture entries
    for (const entry of textureEntries) {
      try {
        let imageBuffer: Buffer;
        let filename: string;
        let mimeType: string;
        let width: number | null = null;
        let height: number | null = null;

        if (parsed.type === "bsp") {
          // Extract BSP texture and convert from MIPTEX
          const texture = await extractBspTexture(tempPath, entry);
          imageBuffer = await miptexToPng(texture);
          filename = `${nanoid()}.png`;
          mimeType = "image/png";
          width = texture.width;
          height = texture.height;
        } else if (parsed.type === "pak" || parsed.type === "pk3") {
          // Extract from PAK or PK3
          imageBuffer = parsed.type === "pak" 
            ? await extractPakEntry(tempPath, entry)
            : await extractPk3Entry(tempPath, entry);
          const entryExt = entry.name.split(".").pop()?.toLowerCase() || "bin";
          
          // Convert legacy formats (TGA, PCX, BMP) to PNG
          if (LEGACY_FORMATS.includes(entryExt)) {
            const converted = await convertLegacyFormat(imageBuffer, entryExt);
            imageBuffer = converted.buffer;
            filename = converted.filename;
            mimeType = converted.mimeType;
            width = converted.width;
            height = converted.height;
          } else {
            filename = `${nanoid()}.${entryExt}`;
            mimeType = getMimeType(entryExt);
            // Get dimensions for native web formats
            if (["png", "jpg", "jpeg", "gif", "webp"].includes(entryExt)) {
              const tempFile = join(TEMP_DIR, filename);
              await writeFile(tempFile, imageBuffer);
              const dims = await getImageDimensions(tempFile);
              width = dims?.width ?? null;
              height = dims?.height ?? null;
              try { await unlink(tempFile); } catch { /* ignore */ }
            }
          }
        } else {
          continue;
        }

        const originalName =
          entry.name.split("/").pop() || entry.name.split("\\").pop() || entry.name;

        await saveTexture(imageBuffer, filename, originalName, mimeType, `extracted-${parsed.type}`, width, height);
      } catch (err) {
        console.error(`Failed to extract ${entry.name}:`, err);
      }
    }

    // Import textures from embedded BSP files (PAK/PK3 only)
    for (const bspEntry of bspEntries) {
      try {
        // Extract the BSP file
        let bspBuffer: Buffer;
        if (parsed.type === "pak") {
          bspBuffer = await extractPakEntry(tempPath, bspEntry);
        } else if (parsed.type === "pk3") {
          bspBuffer = await extractPk3Entry(tempPath, bspEntry);
        } else {
          continue;
        }

        // Parse the BSP to get its textures
        let bspParsed: ParsedBspFile;
        try {
          bspParsed = parseBspBuffer(bspBuffer);
        } catch (err) {
          console.log(`Skipping BSP ${bspEntry.name}: ${err}`);
          continue;
        }

        const bspFilename = bspEntry.name.split("/").pop() || bspEntry.name;
        const bspBaseName = bspFilename.replace(/\.bsp$/i, "");
        
        // Create a subfolder for this BSP's textures
        const bspFolderSlug = `${folderSlug}/${bspBaseName}`
          .toLowerCase()
          .replace(/[^a-z0-9/]+/g, "-")
          .replace(/^-|-$/g, "");
        
        let bspFolder = await db.query.folders.findFirst({
          where: eq(folders.slug, bspFolderSlug),
        });
        
        if (!bspFolder) {
          const [newBspFolder] = await db
            .insert(folders)
            .values({
              id: nanoid(),
              name: bspBaseName,
              slug: bspFolderSlug,
              description: `Textures from ${bspFilename}`,
              parentId: folderId, // Child of main folder
              ownerId: null,
              visibility: "public",
              source: `extracted-${parsed.type}-bsp`,
            })
            .returning();
          bspFolder = newBspFolder;
        }
        
        const bspFolderId = bspFolder.id;
        
        // Helper to save texture to BSP subfolder
        async function saveBspTexture(
          imageBuffer: Buffer,
          filename: string,
          originalName: string,
          mimeType: string,
          source: string,
          width?: number | null,
          height?: number | null
        ) {
          await writeFile(join(UPLOADS_DIR, filename), imageBuffer);
          await db.insert(textures).values({
            id: nanoid(),
            filename,
            originalName,
            mimeType,
            size: imageBuffer.length,
            width: width ?? null,
            height: height ?? null,
            folderId: bspFolderId, // Use BSP subfolder
            uploaderId: null,
            source,
          });
          importedCount++;
        }

        if (bspParsed.bspType === "q1") {
          // Quake 1 BSP - textures are embedded as MIPTEX
          console.log(`Extracting ${bspParsed.entries.length} embedded textures from Q1 BSP: ${bspFilename} -> folder ${bspFolderSlug}`);

          for (const texEntry of bspParsed.entries) {
            try {
              const texture = extractBspTextureFromBuffer(bspBuffer, texEntry);
              const imageBuffer = await miptexToPng(texture, false); // Q1 palette
              const filename = `${nanoid()}.png`;
              const originalName = `${texEntry.name}.png`;

              await saveBspTexture(
                imageBuffer,
                filename,
                originalName,
                "image/png",
                `extracted-${parsed.type}-bsp-q1`,
                texture.width,
                texture.height
              );
            } catch (err) {
              console.error(`Failed to extract ${texEntry.name} from BSP ${bspFilename}:`, err);
            }
          }
        } else if (bspParsed.bspType === "q2") {
          // Quake 2 BSP - textures are external WAL files
          // The BSP entries contain paths like "textures/e1u1/floor1.wal"
          // We need to find these WAL files in the PAK/PK3
          console.log(`Q2 BSP ${bspFilename} references ${bspParsed.entries.length} external textures -> folder ${bspFolderSlug}`);

          for (const texRef of bspParsed.entries) {
            try {
              // Find the WAL file in the archive
              const walPath = texRef.name.toLowerCase();
              const walEntry = parsed.entries.find(
                (e) => e.name.toLowerCase() === walPath
              );

              if (!walEntry) {
                // Try without textures/ prefix or with different casing
                const altPaths = [
                  walPath,
                  walPath.replace("textures/", ""),
                  `textures/${walPath}`,
                ];
                const found = parsed.entries.find((e) =>
                  altPaths.some((p) => e.name.toLowerCase() === p || e.name.toLowerCase().endsWith(p))
                );
                if (!found) {
                  continue; // WAL not found in archive
                }
              }

              const targetEntry = walEntry || parsed.entries.find((e) =>
                e.name.toLowerCase().includes(walPath.replace("textures/", ""))
              );

              if (!targetEntry) continue;

              // Extract the WAL file
              let walBuffer: Buffer;
              if (parsed.type === "pak") {
                walBuffer = await extractPakEntry(tempPath, targetEntry);
              } else {
                walBuffer = await extractPk3Entry(tempPath, targetEntry);
              }

              // Parse and convert WAL to PNG
              const texture = parseWalBuffer(walBuffer);
              const imageBuffer = await miptexToPng(texture, true); // Q2 palette
              const filename = `${nanoid()}.png`;
              const walName = targetEntry.name.split("/").pop() || targetEntry.name;
              const originalName = walName.replace(/\.wal$/i, ".png");

              await saveBspTexture(
                imageBuffer,
                filename,
                originalName,
                "image/png",
                `extracted-${parsed.type}-bsp-q2`,
                texture.width,
                texture.height
              );
            } catch (err) {
              console.error(`Failed to extract ${texRef.name} for BSP ${bspFilename}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to process BSP ${bspEntry.name}:`, err);
      }
    }

    // Also extract standalone WAL files from PAK (Quake 2 texture packs)
    const walEntries = filterWalEntries(parsed.entries);
    for (const walEntry of walEntries) {
      try {
        let walBuffer: Buffer;
        if (parsed.type === "pak") {
          walBuffer = await extractPakEntry(tempPath, walEntry);
        } else if (parsed.type === "pk3") {
          walBuffer = await extractPk3Entry(tempPath, walEntry);
        } else {
          continue;
        }

        const texture = parseWalBuffer(walBuffer);
        const imageBuffer = await miptexToPng(texture, true); // Q2 palette
        const filename = `${nanoid()}.png`;
        const walName = walEntry.name.split("/").pop() || walEntry.name;
        const originalName = walName.replace(/\.wal$/i, ".png");

        await saveTexture(
          imageBuffer,
          filename,
          originalName,
          "image/png",
          `extracted-${parsed.type}-wal`
        );
      } catch (err) {
        console.error(`Failed to extract WAL ${walEntry.name}:`, err);
      }
    }

    // Clean up temp file
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      imported: {
        count: importedCount,
        folderName: folder.name,
        folderSlug: folder.slug,
      },
    };
  } catch (err) {
    return { error: `Failed to import: ${err}` };
  }
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    tga: "image/x-tga",
    bmp: "image/bmp",
    pcx: "image/x-pcx",
    webp: "image/webp",
  };
  return mimeMap[ext] || "application/octet-stream";
}

export function meta() {
  return [{ title: "Extract Game Files - Admin - artbin" }];
}

export default function AdminExtract() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <header className="header">
        <a href="/textures" className="header-logo">
          artbin
        </a>
        <span className="badge-admin">admin</span>
      </header>

      <main className="main-content" style={{ maxWidth: "800px" }}>
        <h1 className="page-title">Extract Game Files</h1>
        <p className="form-help" style={{ marginBottom: "1.5rem" }}>
          Extract textures from Quake-engine game files (PAK, PK3, BSP).
        </p>

        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {actionData?.imported && (
          <div className="alert alert-success">
            Imported {actionData.imported.count} textures into folder "
            {actionData.imported.folderName}"
            <br />
            <a href={`/folder/${actionData.imported.folderSlug}`}>View folder</a>
          </div>
        )}

        {/* Upload Form - show when no parsed data or after successful import */}
        {!actionData?.parsed && (
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="_action" value="upload" />

            <div className="card" style={{ marginBottom: "1.5rem" }}>
              <div className="form-group">
                <label className="form-label">Game File</label>
                <input
                  type="file"
                  name="file"
                  accept=".pak,.pk3,.bsp,.wad"
                  className="input"
                  style={{ width: "100%" }}
                  required
                />
                <p className="form-help">
                  Supported formats: PAK (Quake 1/2), PK3 (Quake 3), BSP (Quake 1 maps)
                </p>
              </div>

              <button type="submit" className="btn btn-primary">
                Analyze File
              </button>
            </div>
          </Form>
        )}

        {/* Preview and Import */}
        {actionData?.parsed && (
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
                File Analysis
              </h3>
              <dl className="detail-info">
                <dt>Type</dt>
                <dd style={{ textTransform: "uppercase" }}>
                  {actionData.parsed.type}
                </dd>
                <dt>Total Entries</dt>
                <dd>{actionData.parsed.totalEntries}</dd>
                <dt>Texture Entries</dt>
                <dd>{actionData.parsed.textureEntries}</dd>
                {actionData.parsed.bspEntries > 0 && (
                  <>
                    <dt>BSP Maps</dt>
                    <dd>{actionData.parsed.bspEntries} (textures will be extracted)</dd>
                  </>
                )}
              </dl>

              <details style={{ marginTop: "1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>
                  Preview entries (first 100)
                </summary>
                <div
                  style={{
                    maxHeight: "300px",
                    overflow: "auto",
                    marginTop: "0.5rem",
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {actionData.parsed.entries.map((e, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "0.25rem",
                        background: e.isBsp
                          ? "#f0f0ff"
                          : e.isTexture
                          ? "#f0fff0"
                          : "transparent",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {e.name}{" "}
                      <span style={{ color: "#999" }}>
                        ({(e.size / 1024).toFixed(1)}KB)
                        {e.isBsp && " [BSP]"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>

            <Form method="post">
              <input type="hidden" name="_action" value="import" />
              <input type="hidden" name="tempFile" value={actionData.parsed.tempFile} />
              <input type="hidden" name="fileType" value={actionData.parsed.type} />

              <div className="form-group">
                <label className="form-label">Folder Name</label>
                <input
                  type="text"
                  name="folderName"
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="e.g., Quake 1 Textures"
                  required
                />
                <p className="form-help">
                  Textures will be imported into this folder
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" className="btn btn-primary">
                  Import {actionData.parsed.textureEntries} Textures
                </button>
                <a href="/admin/extract" className="btn">
                  Cancel
                </a>
              </div>
            </Form>
          </div>
        )}

        <div style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
            Supported Formats
          </h3>
          <ul style={{ paddingLeft: "1.5rem", lineHeight: 1.6 }}>
            <li>
              <strong>PAK</strong> - Quake 1/2 package files containing textures,
              models, sounds
            </li>
            <li>
              <strong>PK3</strong> - Quake 3 package files (ZIP format) with
              TGA/JPG textures
            </li>
            <li>
              <strong>BSP</strong> - Quake 1 map files with embedded MIPTEX
              textures (256-color palette)
            </li>
          </ul>
        </div>

        <p style={{ marginTop: "2rem", fontSize: "0.875rem" }}>
          <a href="/admin/import">TextureTown Import</a> |{" "}
          <a href="/folders">Folders</a> | <a href="/settings">Settings</a>
        </p>
      </main>
    </div>
  );
}

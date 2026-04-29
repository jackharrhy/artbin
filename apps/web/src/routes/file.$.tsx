import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/file.$";
import { userContext } from "~/lib/auth-context.server";
import { db } from "~/db/connection.server";
import { files, folders, fileTags, tags } from "~/db";
import { eq } from "drizzle-orm";
import { ModelViewer } from "~/components/ModelViewer";
import { readFile } from "fs/promises";
import { getFilePath } from "~/lib/files.server";

// Audio formats that browsers can play natively
const WEB_PLAYABLE_AUDIO = new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]);

// Browser-compatible path utilities
function getExtname(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot);
}

function isWebPlayableAudio(filename: string): boolean {
  const ext = getExtname(filename).toLowerCase().slice(1);
  return WEB_PLAYABLE_AUDIO.has(ext);
}

// Check if mime type is text-based and we should show inline preview
function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript"
  );
}

// Model formats supported by our viewer
const MODEL_FORMATS = {
  md2: "md2",
  md5mesh: "md5mesh",
  ase: "ase",
  obj: "obj",
  gltf: "gltf",
  glb: "glb",
} as const;

type ModelFormat = (typeof MODEL_FORMATS)[keyof typeof MODEL_FORMATS] | null;

function getModelFormat(filename: string): ModelFormat {
  const ext = getExtname(filename).toLowerCase().slice(1);
  if (ext in MODEL_FORMATS) {
    return MODEL_FORMATS[ext as keyof typeof MODEL_FORMATS];
  }
  return null;
}

// Max size to load for text preview (100KB)
const MAX_TEXT_PREVIEW_SIZE = 100 * 1024;

// Helper to get texture URL from a file record
function getTextureUrl(textureFile: { path: string; hasPreview: boolean | null }): string {
  if (textureFile.hasPreview) {
    return `/uploads/${textureFile.path}.preview.png`;
  }
  return `/uploads/${textureFile.path}`;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(userContext);

  // Get file path from splat
  const filePath = params["*"];
  if (!filePath) {
    throw new Response("File not found", { status: 404 });
  }

  // Find file by path
  const file = await db.query.files.findFirst({
    where: eq(files.path, filePath),
  });

  if (!file) {
    throw new Response("File not found", { status: 404 });
  }

  // Get folder and build ancestor chain for breadcrumbs
  let folder = null;
  const ancestors: { id: string; name: string; slug: string }[] = [];

  if (file.folderId) {
    folder = await db.query.folders.findFirst({
      where: eq(folders.id, file.folderId),
    });

    // Build ancestor chain
    if (folder) {
      let currentParentId = folder.parentId;
      while (currentParentId) {
        const parent = await db.query.folders.findFirst({
          where: eq(folders.id, currentParentId),
        });
        if (!parent) break;
        ancestors.unshift(parent);
        currentParentId = parent.parentId;
      }
    }
  }

  // Get tags
  const fileTagRecords = await db
    .select({ tag: tags })
    .from(fileTags)
    .innerJoin(tags, eq(fileTags.tagId, tags.id))
    .where(eq(fileTags.fileId, file.id));

  const fileTags_ = fileTagRecords.map((r) => r.tag);

  // Load text content for text files (if small enough)
  let textContent: string | null = null;
  let textTruncated = false;

  if (isTextMimeType(file.mimeType) && file.size <= MAX_TEXT_PREVIEW_SIZE) {
    try {
      const fullPath = getFilePath(file.path);
      textContent = await readFile(fullPath, "utf-8");
    } catch {
      // Failed to read, leave as null
    }
  } else if (isTextMimeType(file.mimeType)) {
    textTruncated = true;
  }

  // For model files, look for associated texture/material files
  let modelTexture: string | null = null;
  let modelMtl: string | null = null;

  if (file.kind === "model" && file.folderId) {
    const textureExts = ["tga", "png", "jpg", "jpeg", "pcx", "bmp"];

    // Get all files in the same folder for smart matching
    const siblingFiles = await db.query.files.findMany({
      where: eq(files.folderId, file.folderId),
    });

    const siblingTextures = siblingFiles.filter((f) => f.kind === "texture");
    const siblingConfigs = siblingFiles.filter(
      (f) => f.name.endsWith(".script") || f.name.endsWith(".skin") || f.name.endsWith(".mtr"),
    );

    // Strategy 1: Look for texture with same base name as model
    const baseName = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    for (const ext of textureExts) {
      const match = siblingTextures.find((f) => f.name.toLowerCase() === `${baseName}.${ext}`);
      if (match) {
        modelTexture = getTextureUrl(match);
        break;
      }
    }

    // Strategy 2: Look for common MD2 skin naming conventions
    if (!modelTexture) {
      const skinNames = ["skin", "skin1", "skin0", "default", baseName + "_skin"];
      for (const skinName of skinNames) {
        for (const ext of textureExts) {
          const match = siblingTextures.find((f) => f.name.toLowerCase() === `${skinName}.${ext}`);
          if (match) {
            modelTexture = getTextureUrl(match);
            break;
          }
        }
        if (modelTexture) break;
      }
    }

    // Strategy 3: Parse .script/.skin/.mtr files for texture references
    if (!modelTexture && siblingConfigs.length > 0) {
      for (const configFile of siblingConfigs) {
        try {
          const configPath = getFilePath(configFile.path);
          const content = await readFile(configPath, "utf-8");

          // Look for texture path references in the config
          // Common patterns: "models/path/texture.jpg", map models/path/texture
          const texturePatterns = [
            /(?:map|diffusemap|bumpmap)\s+(\S+\.(?:tga|png|jpg|jpeg))/gi,
            /["']([^"']+\.(?:tga|png|jpg|jpeg))["']/gi,
            /\s(models\/[^\s]+\.(?:tga|png|jpg|jpeg))/gi,
          ];

          for (const pattern of texturePatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
              const texPath = match[1];
              // Try to find this texture - could be relative or absolute path
              const texName = texPath.split("/").pop()?.toLowerCase();
              if (texName) {
                const foundTex = siblingTextures.find((f) => f.name.toLowerCase() === texName);
                if (foundTex) {
                  modelTexture = getTextureUrl(foundTex);
                  break;
                }
              }
            }
            if (modelTexture) break;
          }
        } catch {
          // Failed to read config, continue
        }
        if (modelTexture) break;
      }
    }

    // Strategy 4: If there's only one texture in the folder, use it
    if (!modelTexture && siblingTextures.length === 1) {
      modelTexture = getTextureUrl(siblingTextures[0]);
    }

    // Strategy 5: If there are few textures, prefer ones that look like diffuse maps
    if (!modelTexture && siblingTextures.length > 0 && siblingTextures.length <= 5) {
      // Avoid normal maps, glow maps, spec maps
      const avoidPatterns = /_(?:normal|nrm|bump|spec|specular|glow|emit|ao|height|rough)/i;
      const diffuseCandidate = siblingTextures.find((f) => !avoidPatterns.test(f.name));
      if (diffuseCandidate) {
        modelTexture = getTextureUrl(diffuseCandidate);
      }
    }

    // For OBJ files, look for MTL file
    if (file.name.toLowerCase().endsWith(".obj")) {
      const mtlPath = file.path.replace(/\.obj$/i, ".mtl");
      const mtlFile = await db.query.files.findFirst({
        where: eq(files.path, mtlPath),
      });
      if (mtlFile) {
        modelMtl = `/uploads/${mtlFile.path}`;
      }
    }

    // For MD5 mesh files, find sibling animation files
    let modelAnimations: { name: string; url: string }[] = [];
    if (file.name.toLowerCase().endsWith(".md5mesh")) {
      const siblingAnims = siblingFiles.filter((f) => f.name.toLowerCase().endsWith(".md5anim"));
      modelAnimations = siblingAnims.map((f) => ({
        name: f.name.replace(/\.md5anim$/i, ""),
        url: `/uploads/${f.path}`,
      }));
    }

    // Return available textures for manual selection
    const availableTextures = siblingTextures.map((f) => ({
      name: f.name,
      url: getTextureUrl(f),
    }));

    return {
      user,
      file,
      folder,
      ancestors,
      tags: fileTags_,
      textContent,
      textTruncated,
      modelTexture,
      modelMtl,
      availableTextures,
      modelAnimations,
    };
  }

  return {
    user,
    file,
    folder,
    ancestors,
    tags: fileTags_,
    textContent,
    textTruncated,
    modelTexture,
    modelMtl,
    availableTextures: [],
    modelAnimations: [],
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.file?.name || "File"} - artbin` }];
}

function getDisplayUrl(file: { path: string; hasPreview: boolean | null }): string {
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function getAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  const ratioW = width / divisor;
  const ratioH = height / divisor;

  // Common ratios
  if (ratioW === 1 && ratioH === 1) return "1:1";
  if (ratioW === 16 && ratioH === 9) return "16:9";
  if (ratioW === 4 && ratioH === 3) return "4:3";
  if (ratioW === 3 && ratioH === 2) return "3:2";
  if (ratioW === 2 && ratioH === 1) return "2:1";

  // If ratio numbers are reasonable, show them
  if (ratioW <= 32 && ratioH <= 32) {
    return `${ratioW}:${ratioH}`;
  }

  // Otherwise show decimal
  return (width / height).toFixed(2);
}

export default function FileView() {
  const {
    user,
    file,
    folder,
    ancestors,
    tags,
    textContent,
    textTruncated,
    modelTexture,
    modelMtl,
    availableTextures,
    modelAnimations,
  } = useLoaderData<typeof loader>();
  const [selectedTexture, setSelectedTexture] = useState<string | undefined>(
    modelTexture || undefined,
  );

  const isImage = file.kind === "texture";
  const isModel = file.kind === "model";
  const isAudio = file.kind === "audio";
  const isTextFile = isTextMimeType(file.mimeType);
  const modelFormat = getModelFormat(file.name);

  const displayUrl = getDisplayUrl(file);
  const downloadUrl = `/uploads/${file.path}`;

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      {/* Breadcrumb */}
      <div className="text-xs text-text-muted mb-4">
        <a href="/folders" className="text-text-muted hover:text-text no-underline">
          Folders
        </a>
        {ancestors.map((ancestor) => (
          <span key={ancestor.id}>
            <span className="mx-2">/</span>
            <a
              href={`/folder/${ancestor.slug}`}
              className="text-text-muted hover:text-text no-underline"
            >
              {ancestor.name}
            </a>
          </span>
        ))}
        {folder && (
          <>
            <span className="mx-2">/</span>
            <a
              href={`/folder/${folder.slug}`}
              className="text-text-muted hover:text-text no-underline"
            >
              {folder.name}
            </a>
          </>
        )}
        <span className="mx-2">/</span>
        <span>{file.name}</span>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6 max-md:grid-cols-1">
        {/* Preview */}
        <div className="bg-[#fafafa] border border-border-light flex items-center justify-center min-h-[300px]">
          {isImage && (
            <a href={downloadUrl} target="_blank" rel="noopener">
              <img
                src={displayUrl}
                alt={file.name}
                className="max-w-full max-h-[500px] object-contain block"
                style={{ imageRendering: "pixelated" }}
              />
            </a>
          )}

          {isModel && modelFormat && (
            <div className="w-full">
              <ModelViewer
                modelUrl={downloadUrl}
                textureUrl={selectedTexture}
                mtlUrl={modelMtl || undefined}
                animUrls={
                  modelAnimations.length > 0 ? modelAnimations.map((a) => a.url) : undefined
                }
                format={modelFormat}
                height={450}
              />
              {availableTextures.length > 1 && (
                <div className="p-2 bg-bg border-t border-bg-subtle flex items-center gap-2 text-[0.8125rem]">
                  <label className="text-text-muted">Texture:</label>
                  <select
                    value={selectedTexture || ""}
                    onChange={(e) => setSelectedTexture(e.target.value || undefined)}
                    className="flex-1 p-1 border border-border-light text-[0.8125rem]"
                  >
                    <option value="">None</option>
                    {availableTextures.map((tex) => (
                      <option key={tex.url} value={tex.url}>
                        {tex.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {isModel && !modelFormat && (
            <div className="h-[400px] bg-bg-hover flex items-center justify-center">
              <div className="text-center text-text-faint">
                <div className="text-5xl">📦</div>
                <div>3D Model</div>
                <div className="text-sm mt-2">Format not supported for preview</div>
                <a href={downloadUrl} className="btn mt-4 inline-block">
                  Download
                </a>
              </div>
            </div>
          )}

          {isAudio && isWebPlayableAudio(file.name) && (
            <div className="p-8 text-center w-full">
              <div className="text-5xl mb-4">🔊</div>
              <audio controls src={downloadUrl} className="w-full min-w-[300px]">
                Your browser does not support the audio element.
              </audio>
              <div className="mt-4">
                <a href={downloadUrl} className="btn" download>
                  Download
                </a>
              </div>
            </div>
          )}

          {isAudio && !isWebPlayableAudio(file.name) && (
            <div className="p-12 text-center bg-bg-hover">
              <div className="text-5xl mb-4">🔊</div>
              <div className="mb-2">{getExtname(file.name).slice(1).toUpperCase()} Audio</div>
              <div className="text-sm text-text-muted mb-4">
                This format cannot be played in the browser
              </div>
              <a href={downloadUrl} className="btn btn-primary" download>
                Download
              </a>
            </div>
          )}

          {/* Text file preview */}
          {isTextFile && textContent && (
            <div className="w-full max-h-[600px] overflow-auto bg-bg m-4">
              <pre className="m-0 p-2 font-mono text-[0.8125rem] leading-relaxed text-text whitespace-pre-wrap break-words">
                {textContent}
              </pre>
            </div>
          )}

          {isTextFile && textTruncated && (
            <div className="p-12 text-center bg-bg-hover">
              <div className="text-5xl mb-4">📄</div>
              <div className="mb-2">Text File</div>
              <div className="text-sm text-text-muted mb-4">
                File too large to preview ({formatSize(file.size)})
              </div>
              <a href={downloadUrl} className="btn btn-primary" download>
                Download
              </a>
            </div>
          )}

          {isTextFile && !textContent && !textTruncated && (
            <div className="p-12 text-center bg-bg-hover">
              <div className="text-5xl mb-4">📄</div>
              <div className="mb-4">Text File</div>
              <a href={downloadUrl} className="btn btn-primary" download>
                Download
              </a>
            </div>
          )}

          {!isImage && !isModel && !isAudio && !isTextFile && (
            <div className="p-12 text-center bg-bg-hover">
              <div className="text-5xl mb-4">
                {file.kind === "map" ? "🗺️" : file.kind === "archive" ? "📁" : "📎"}
              </div>
              <div className="mb-4">{file.kind || "File"}</div>
              <a href={downloadUrl} className="btn btn-primary">
                Download
              </a>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="card">
          <h2 className="font-medium mb-4">{file.name}</h2>

          <dl>
            <dt className="text-xs text-text-muted uppercase tracking-wide">Kind</dt>
            <dd className="mb-3 capitalize">{file.kind}</dd>

            <dt className="text-xs text-text-muted uppercase tracking-wide">Size</dt>
            <dd className="mb-3">{formatSize(file.size)}</dd>

            <dt className="text-xs text-text-muted uppercase tracking-wide">Type</dt>
            <dd className="mb-3">{file.mimeType}</dd>

            {file.width && file.height && (
              <>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Dimensions</dt>
                <dd className="mb-3">
                  {file.width} × {file.height}
                </dd>

                <dt className="text-xs text-text-muted uppercase tracking-wide">Aspect Ratio</dt>
                <dd className="mb-3">{getAspectRatio(file.width, file.height)}</dd>
              </>
            )}

            {file.source && (
              <>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Source</dt>
                <dd className="mb-3">{file.source}</dd>
              </>
            )}

            {file.sourceArchive && (
              <>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Archive</dt>
                <dd className="mb-3">{file.sourceArchive}</dd>
              </>
            )}

            <dt className="text-xs text-text-muted uppercase tracking-wide">Path</dt>
            <dd className="mb-3">
              <code className="text-xs">{file.path}</code>
            </dd>
          </dl>

          {tags.length > 0 && (
            <div className="mt-4">
              <h3 className="font-medium mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span key={tag.id} className="tag">
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <a href={downloadUrl} className="btn btn-primary" download>
              Download Original
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

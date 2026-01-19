import { useState } from "react";
import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/file.$";
import { parseSessionCookie, getUserFromSession } from "~/lib/auth.server";
import { db, files, folders, fileTags, tags } from "~/db";
import { eq } from "drizzle-orm";
import { Header } from "~/components/Header";
import { ModelViewer } from "~/components/ModelViewer";
import { readFile } from "fs/promises";
import { getFilePath } from "~/lib/files.server";

// Audio formats that browsers can play natively
const WEB_PLAYABLE_AUDIO = ["mp3", "ogg", "wav", "m4a", "webm", "aac"];

// Browser-compatible path utilities
function getExtname(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot);
}

function isWebPlayableAudio(filename: string): boolean {
  const ext = getExtname(filename).toLowerCase().slice(1);
  return WEB_PLAYABLE_AUDIO.includes(ext);
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

export async function loader({ request, params }: Route.LoaderArgs) {
  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  const user = await getUserFromSession(sessionId);

  if (!user) {
    return redirect("/login");
  }

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
    
    // Helper to get texture URL from a file record
    const getTextureUrl = (textureFile: { path: string; hasPreview: boolean | null }) => {
      if (textureFile.hasPreview) {
        return `/uploads/${textureFile.path}.preview.png`;
      }
      return `/uploads/${textureFile.path}`;
    };
    
    // Get all files in the same folder for smart matching
    const siblingFiles = await db.query.files.findMany({
      where: eq(files.folderId, file.folderId),
    });
    
    const siblingTextures = siblingFiles.filter(f => f.kind === "texture");
    const siblingConfigs = siblingFiles.filter(f => 
      f.name.endsWith(".script") || f.name.endsWith(".skin") || f.name.endsWith(".mtr")
    );
    
    // Strategy 1: Look for texture with same base name as model
    const baseName = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    for (const ext of textureExts) {
      const match = siblingTextures.find(f => 
        f.name.toLowerCase() === `${baseName}.${ext}`
      );
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
          const match = siblingTextures.find(f => 
            f.name.toLowerCase() === `${skinName}.${ext}`
          );
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
                const foundTex = siblingTextures.find(f => 
                  f.name.toLowerCase() === texName
                );
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
      const diffuseCandidate = siblingTextures.find(f => !avoidPatterns.test(f.name));
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
      const siblingAnims = siblingFiles.filter(f => 
        f.name.toLowerCase().endsWith(".md5anim")
      );
      modelAnimations = siblingAnims.map(f => ({
        name: f.name.replace(/\.md5anim$/i, ""),
        url: `/uploads/${f.path}`,
      }));
    }
    
    // Return available textures for manual selection
    const availableTextures = siblingTextures.map(f => ({
      name: f.name,
      url: getTextureUrl(f),
    }));
    
    return { user, file, folder, ancestors, tags: fileTags_, textContent, textTruncated, modelTexture, modelMtl, availableTextures, modelAnimations };
  }

  return { user, file, folder, ancestors, tags: fileTags_, textContent, textTruncated, modelTexture, modelMtl, availableTextures: [], modelAnimations: [] };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.file?.name || "File"} - artbin` }];
}

/**
 * Get display URL for file
 */
function getDisplayUrl(file: {
  path: string;
  hasPreview: boolean | null;
}): string {
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculate aspect ratio as a human-readable string
 */
function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
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
  const { user, file, folder, ancestors, tags, textContent, textTruncated, modelTexture, modelMtl, availableTextures, modelAnimations } = useLoaderData<typeof loader>();
  const [selectedTexture, setSelectedTexture] = useState<string | undefined>(modelTexture || undefined);

  const isImage = file.kind === "texture";
  const isModel = file.kind === "model";
  const isAudio = file.kind === "audio";
  const isTextFile = isTextMimeType(file.mimeType);
  const modelFormat = getModelFormat(file.name);

  const displayUrl = getDisplayUrl(file);
  const downloadUrl = `/uploads/${file.path}`;

  return (
    <div>
      <Header user={user} />
      <main className="main-content">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/folders">Folders</a>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${ancestor.slug}`}>{ancestor.name}</a>
            </span>
          ))}
          {folder && (
            <>
              <span className="breadcrumb-sep">/</span>
              <a href={`/folder/${folder.slug}`}>{folder.name}</a>
            </>
          )}
          <span className="breadcrumb-sep">/</span>
          <span>{file.name}</span>
        </div>

        <div className="file-detail">
          {/* Preview */}
          <div className="file-preview">
            {isImage && (
              <a href={downloadUrl} target="_blank" rel="noopener">
                <img
                  src={displayUrl}
                  alt={file.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "500px",
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
              </a>
            )}

            {isModel && modelFormat && (
              <div style={{ width: "100%" }}>
                <ModelViewer
                  modelUrl={downloadUrl}
                  textureUrl={selectedTexture}
                  mtlUrl={modelMtl || undefined}
                  animUrls={modelAnimations.length > 0 ? modelAnimations.map(a => a.url) : undefined}
                  format={modelFormat}
                  height={450}
                />
                {availableTextures.length > 1 && (
                  <div style={{ 
                    padding: "0.5rem", 
                    background: "#fff",
                    borderTop: "1px solid #eee",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.8125rem",
                  }}>
                    <label style={{ color: "#666" }}>Texture:</label>
                    <select
                      value={selectedTexture || ""}
                      onChange={(e) => setSelectedTexture(e.target.value || undefined)}
                      style={{
                        flex: 1,
                        padding: "0.25rem",
                        border: "1px solid #ccc",
                        borderRadius: "3px",
                        fontSize: "0.8125rem",
                      }}
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
              <div
                style={{
                  height: "400px",
                  background: "#f5f5f5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ textAlign: "center", color: "#999" }}>
                  <div style={{ fontSize: "3rem" }}>📦</div>
                  <div>3D Model</div>
                  <div style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                    Format not supported for preview
                  </div>
                  <a href={downloadUrl} className="btn" style={{ marginTop: "1rem" }}>
                    Download
                  </a>
                </div>
              </div>
            )}

            {isAudio && isWebPlayableAudio(file.name) && (
              <div style={{ padding: "2rem", textAlign: "center", width: "100%" }}>
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔊</div>
                <audio controls src={downloadUrl} style={{ width: "100%", minWidth: "300px" }}>
                  Your browser does not support the audio element.
                </audio>
                <div style={{ marginTop: "1rem" }}>
                  <a href={downloadUrl} className="btn" download>
                    Download
                  </a>
                </div>
              </div>
            )}

            {isAudio && !isWebPlayableAudio(file.name) && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔊</div>
                <div style={{ marginBottom: "0.5rem" }}>{getExtname(file.name).slice(1).toUpperCase()} Audio</div>
                <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
                  This format cannot be played in the browser
                </div>
                <a href={downloadUrl} className="btn btn-primary" download>
                  Download
                </a>
              </div>
            )}

            {/* Text file preview */}
            {isTextFile && textContent && (
              <div className="text-preview-container">
                <pre className="text-preview">{textContent}</pre>
              </div>
            )}

            {isTextFile && textTruncated && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📄</div>
                <div style={{ marginBottom: "0.5rem" }}>Text File</div>
                <div style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
                  File too large to preview ({formatSize(file.size)})
                </div>
                <a href={downloadUrl} className="btn btn-primary" download>
                  Download
                </a>
              </div>
            )}

            {isTextFile && !textContent && !textTruncated && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📄</div>
                <div style={{ marginBottom: "1rem" }}>Text File</div>
                <a href={downloadUrl} className="btn btn-primary" download>
                  Download
                </a>
              </div>
            )}

            {!isImage && !isModel && !isAudio && !isTextFile && (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
                  {file.kind === "map"
                    ? "🗺️"
                    : file.kind === "archive"
                    ? "📁"
                    : "📎"}
                </div>
                <div style={{ marginBottom: "1rem" }}>{file.kind || "File"}</div>
                <a href={downloadUrl} className="btn btn-primary">
                  Download
                </a>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="file-info card">
            <h2 style={{ fontWeight: 500, marginBottom: "1rem" }}>{file.name}</h2>

            <dl className="detail-info">
              <dt>Kind</dt>
              <dd style={{ textTransform: "capitalize" }}>{file.kind}</dd>

              <dt>Size</dt>
              <dd>{formatSize(file.size)}</dd>

              <dt>Type</dt>
              <dd>{file.mimeType}</dd>

              {file.width && file.height && (
                <>
                  <dt>Dimensions</dt>
                  <dd>
                    {file.width} × {file.height}
                  </dd>

                  <dt>Aspect Ratio</dt>
                  <dd>{getAspectRatio(file.width, file.height)}</dd>
                </>
              )}

              {file.source && (
                <>
                  <dt>Source</dt>
                  <dd>{file.source}</dd>
                </>
              )}

              {file.sourceArchive && (
                <>
                  <dt>Archive</dt>
                  <dd>{file.sourceArchive}</dd>
                </>
              )}

              <dt>Path</dt>
              <dd>
                <code style={{ fontSize: "0.75rem" }}>{file.path}</code>
              </dd>
            </dl>

            {tags.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Tags</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      style={{
                        padding: "0.125rem 0.5rem",
                        background: "#f0f0f0",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: "1.5rem" }}>
              <a href={downloadUrl} className="btn btn-primary" download>
                Download Original
              </a>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .file-detail {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 1.5rem;
        }
        
        @media (max-width: 768px) {
          .file-detail {
            grid-template-columns: 1fr;
          }
        }
        
        .file-preview {
          background: #fafafa;
          border: 1px solid #eee;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 300px;
        }
        
        .file-preview img {
          display: block;
        }

        .text-preview-container {
          width: 100%;
          max-height: 600px;
          overflow: auto;
          background: #fff;
          margin: 1rem;
        }

        .text-preview {
          margin: 0;
          padding: 0.5rem;
          font-family: var(--font-mono);
          font-size: 0.8125rem;
          line-height: 1.5;
          color: #111;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      `}</style>
    </div>
  );
}

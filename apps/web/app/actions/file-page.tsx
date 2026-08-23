import type { Handle } from "remix/ui";

import type { User } from "#db";

import {
  isTextMimeType,
  type FilePageData,
  type StandardFilePageData,
  type WadTexturePageData,
} from "../data/file-page.ts";
import { routes } from "../routes.ts";
import { formatSize } from "../ui/file-collection.tsx";
import { LuckyButton } from "../ui/public/lucky-button.tsx";
import { ModelViewer, type ModelFormat } from "../ui/public/model-viewer.tsx";
import { Page } from "../ui/page.tsx";

export function FileRoutePage(handle: Handle<{ data: FilePageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    return data.page === "wad-texture" ? (
      <WadTexturePage data={data} user={user} />
    ) : data.page === "file" ? (
      <StandardFilePage data={data} user={user} />
    ) : null;
  };
}

function StandardFilePage(handle: Handle<{ data: StandardFilePageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const { file } = data;
    const downloadUrl = `/uploads/${file.path}`;
    const displayUrl = `${downloadUrl}${file.hasPreview ? ".preview.png" : ""}`;
    const image = file.kind === "texture";
    const model = file.kind === "model";
    const audio = file.kind === "audio";
    const text = isTextMimeType(file.mimeType);
    const modelFormat = getModelFormat(file.name);

    return (
      <Page title={`${file.name} - artbin`} user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <div className="mb-4 flex items-center justify-between gap-4 border border-border-light bg-bg-hover px-3 py-2 text-sm max-sm:items-start max-sm:flex-col">
            <LuckyButton
              contextual
              excludeHref={routes.file.href({ path: file.path })}
              historyLabel="Lucky again"
            />
          </div>
          <FileBreadcrumb data={data} />
          <div className="grid grid-cols-[1fr_300px] gap-6 max-md:grid-cols-1">
            <div className="bg-[#fafafa] border border-border-light flex items-center justify-center min-h-[300px]">
              {image ? (
                <a href={downloadUrl} target="_blank" rel="noopener">
                  <img
                    src={displayUrl}
                    alt={file.name}
                    className="max-w-full max-h-[500px] object-contain block"
                    style={{ imageRendering: "pixelated" }}
                  />
                </a>
              ) : model ? (
                modelFormat ? (
                  <ModelViewer
                    modelUrl={downloadUrl}
                    textureUrl={data.modelTexture ?? undefined}
                    textures={data.availableTextures}
                    mtlUrl={data.modelMtl ?? undefined}
                    animUrls={data.modelAnimations.map((animation) => animation.url)}
                    format={modelFormat}
                    height={450}
                  />
                ) : (
                  <DownloadFallback
                    icon="📦"
                    title="3D model"
                    message="This model format cannot be previewed in the browser."
                    href={downloadUrl}
                  />
                )
              ) : audio && isWebPlayableAudio(file.name) ? (
                <div className="p-8 text-center w-full">
                  <div className="text-5xl mb-4">🔊</div>
                  <audio controls src={downloadUrl} className="w-full min-w-[300px]">
                    Your browser does not support the audio element.
                  </audio>
                </div>
              ) : text && data.textContent !== null ? (
                <div className="w-full max-h-[600px] overflow-auto bg-bg m-4">
                  <pre className="m-0 p-2 font-mono text-[0.8125rem] leading-relaxed text-text whitespace-pre-wrap break-words">
                    {data.textContent}
                  </pre>
                </div>
              ) : (
                <DownloadFallback
                  icon={
                    audio
                      ? "🔊"
                      : file.kind === "map"
                        ? "🗺️"
                        : file.kind === "archive"
                          ? "📁"
                          : "📎"
                  }
                  title={data.textTruncated ? "Text file" : (file.kind ?? "File")}
                  message={
                    data.textTruncated
                      ? `This file is too large to preview (${formatSize(file.size)}).`
                      : "This file is available to download."
                  }
                  href={downloadUrl}
                />
              )}
            </div>
            <FileDetails data={data} downloadUrl={downloadUrl} />
          </div>
        </main>
      </Page>
    );
  };
}

function getModelFormat(name: string): ModelFormat | null {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ["md2", "md5mesh", "ase", "obj", "gltf", "glb"].includes(extension)
    ? (extension as ModelFormat)
    : null;
}

function FileDetails(handle: Handle<{ data: StandardFilePageData; downloadUrl: string }>) {
  return () => {
    const { data, downloadUrl } = handle.props;
    const { file } = data;
    return (
      <aside className="card self-start">
        <h1 className="font-medium mb-4 break-words">{file.name}</h1>
        <dl>
          <dt className="text-xs text-text-muted uppercase tracking-wide">Kind</dt>
          <dd className="mb-3 capitalize">{file.kind}</dd>
          <dt className="text-xs text-text-muted uppercase tracking-wide">Size</dt>
          <dd className="mb-3">{formatSize(file.size)}</dd>
          <dt className="text-xs text-text-muted uppercase tracking-wide">Type</dt>
          <dd className="mb-3 break-words">{file.mimeType}</dd>
          {file.width && file.height ? (
            <>
              <dt className="text-xs text-text-muted uppercase tracking-wide">Dimensions</dt>
              <dd className="mb-3">
                {file.width} × {file.height}
              </dd>
              <dt className="text-xs text-text-muted uppercase tracking-wide">Aspect ratio</dt>
              <dd className="mb-3">{aspectRatio(file.width, file.height)}</dd>
            </>
          ) : null}
          {file.source ? (
            <>
              <dt className="text-xs text-text-muted uppercase tracking-wide">Source</dt>
              <dd className="mb-3">{file.source}</dd>
            </>
          ) : null}
          {file.sourceArchive ? (
            <>
              <dt className="text-xs text-text-muted uppercase tracking-wide">Archive</dt>
              <dd className="mb-3 break-words">{file.sourceArchive}</dd>
            </>
          ) : null}
          <dt className="text-xs text-text-muted uppercase tracking-wide">Path</dt>
          <dd className="mb-3 break-all">
            <code className="text-xs">{file.path}</code>
          </dd>
        </dl>
        {data.tags.length ? (
          <div className="mt-4">
            <h2 className="font-medium mb-2">Tags</h2>
            <div className="flex flex-wrap gap-1">
              {data.tags.map((tag) => (
                <span key={tag.id} className="tag">
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {data.availableTextures.length > 1 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm">Related textures</summary>
            <ul className="mt-2 text-xs break-all">
              {data.availableTextures.map((texture) => (
                <li key={texture.url}>
                  <a href={texture.url}>{texture.name}</a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-6">
          <a href={downloadUrl} className="btn btn-primary" download>
            Download original
          </a>
        </div>
      </aside>
    );
  };
}

function FileBreadcrumb(handle: Handle<{ data: StandardFilePageData }>) {
  return () => {
    const { data } = handle.props;
    return (
      <div className="text-xs text-text-muted mb-4">
        <a href={routes.folders.href()} className="text-text-muted no-underline">
          Folders
        </a>
        {data.ancestors.map((ancestor) => (
          <span key={ancestor.id}>
            <span className="mx-2">/</span>
            <a
              href={routes.folder.index.href({ path: ancestor.slug })}
              className="text-text-muted no-underline"
            >
              {ancestor.name}
            </a>
          </span>
        ))}
        {data.folder ? (
          <span>
            <span className="mx-2">/</span>
            <a
              href={routes.folder.index.href({ path: data.folder.slug })}
              className="text-text-muted no-underline"
            >
              {data.folder.name}
            </a>
          </span>
        ) : null}
        <span className="mx-2">/</span>
        <span>{data.file.name}</span>
      </div>
    );
  };
}

function WadTexturePage(handle: Handle<{ data: WadTexturePageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const imageUrl = routes.api.wadTexture.href({
      fileId: data.file.id,
      textureIndex: String(data.texture.index),
    });
    const libraryHref = routes.folder.index.href({ path: data.file.path });
    const textureHref = routes.file.href({
      path: `${data.file.path}/${textureFilename(data.texture, data.contents.textures)}`,
    });

    return (
      <Page title={`${data.texture.name} - artbin`} user={user}>
        <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
          <div className="mb-4 flex items-center justify-between gap-4 border border-border-light bg-bg-hover px-3 py-2 text-sm max-sm:flex-col">
            <LuckyButton
              contextual
              fallbackWadFileId={data.file.id}
              fallbackSourceLabel={data.file.name}
              excludeHref={textureHref}
              label="Random texture"
              historyLabel="Lucky again"
            />
          </div>
          <div className="text-xs text-text-muted mb-4">
            <a href={routes.folders.href()}>Folders</a>
            {data.folderTrail.map((folder) => (
              <span key={folder.id}>
                <span className="mx-2">/</span>
                <a href={routes.folder.index.href({ path: folder.slug })}>{folder.name}</a>
              </span>
            ))}
            <span className="mx-2">/</span>
            <a href={libraryHref}>{data.file.name}</a>
            <span className="mx-2">/</span>
            <span>{data.texture.name}</span>
          </div>
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-xl font-normal">{data.texture.name}</h1>
          </div>
          <div className="grid grid-cols-[1fr_300px] gap-6 max-md:grid-cols-1">
            <div className="min-h-[420px] border border-border-light bg-[#fafafa] flex items-center justify-center p-6">
              <img
                src={imageUrl}
                alt={data.texture.name}
                className="max-w-full max-h-[70vh] object-contain block"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <aside className="card self-start">
              <h2 className="font-medium mb-4">Texture details</h2>
              <dl>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Dimensions</dt>
                <dd className="mb-3">
                  {data.texture.width} × {data.texture.height}
                </dd>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Transparency</dt>
                <dd className="mb-3">{data.texture.isTransparent ? "Masked" : "Opaque"}</dd>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Library</dt>
                <dd className="mb-3">
                  <a href={libraryHref}>{data.file.name}</a>
                </dd>
                <dt className="text-xs text-text-muted uppercase tracking-wide">Format</dt>
                <dd className="mb-3">{data.contents.version}</dd>
              </dl>
              <div className="mt-6 flex flex-col gap-2">
                <a href={imageUrl} className="btn btn-primary text-center" download>
                  Download PNG
                </a>
                <a href={`/uploads/${data.file.path}`} className="btn text-center" download>
                  Download original WAD
                </a>
              </div>
            </aside>
          </div>
        </main>
      </Page>
    );
  };
}

function DownloadFallback(
  handle: Handle<{ icon: string; title: string; message: string; href: string }>,
) {
  return () => (
    <div className="p-12 text-center bg-bg-hover">
      <div className="text-5xl mb-4">{handle.props.icon}</div>
      <div className="mb-2 capitalize">{handle.props.title}</div>
      <div className="text-sm text-text-muted mb-4">{handle.props.message}</div>
      <a href={handle.props.href} className="btn btn-primary" download>
        Download
      </a>
    </div>
  );
}

function isWebPlayableAudio(filename: string): boolean {
  return new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]).has(
    filename.split(".").pop()?.toLowerCase() ?? "",
  );
}

function aspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function textureFilename(
  texture: { index: number; name: string },
  textures: Array<{ index: number; name: string }>,
): string {
  const duplicate = textures.some(
    (candidate) =>
      candidate.index !== texture.index &&
      candidate.name.toLowerCase() === texture.name.toLowerCase(),
  );
  return `${texture.name}${duplicate ? `~${texture.index}` : ""}.png`;
}

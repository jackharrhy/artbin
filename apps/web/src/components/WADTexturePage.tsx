import { useLocation } from "react-router";
import type { WADContents, WADTextureInfo } from "@artbin/core/parsers/wad";

import { getLuckyContext, LuckyButton } from "./LuckyButton";
import { getWADLibraryHref, getWADTextureHref } from "~/lib/wad-paths";

interface WADTexturePageProps {
  file: { id: string; path: string; name: string };
  contents: WADContents;
  texture: WADTextureInfo;
  folderTrail: Array<{ id: string; name: string; slug: string }>;
}

export function WADTexturePage({ file, contents, texture, folderTrail }: WADTexturePageProps) {
  const location = useLocation();
  const luckyContext = getLuckyContext(location.state);
  const imageUrl = `/api/wad/${file.id}/texture/${texture.index}`;
  const libraryHref = getWADLibraryHref(file.path);
  const textureHref = getWADTextureHref(file.path, texture, contents.textures);
  const wadContext = {
    sourceHref: libraryHref,
    sourceLabel: file.name,
    wadFileId: file.id,
  };

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
      {luckyContext && (
        <div className="mb-4 flex items-center justify-between gap-4 border border-border-light bg-bg-hover px-3 py-2 text-sm max-sm:items-start max-sm:flex-col">
          <span className="text-text-muted">
            Feeling lucky in{" "}
            <a href={luckyContext.sourceHref} className="text-text hover:underline">
              {luckyContext.sourceLabel}
            </a>
          </span>
          <LuckyButton
            folderId={luckyContext.folderId}
            wadFileId={luckyContext.wadFileId}
            sourceLabel={luckyContext.sourceLabel}
            context={luckyContext}
            excludeHref={textureHref}
            replace
            label="Lucky again"
            className="btn btn-primary btn-sm"
          />
        </div>
      )}

      <div className="text-xs text-text-muted mb-4">
        <a className="text-text-muted hover:text-text" href="/folders">
          Folders
        </a>
        {folderTrail.map((folder) => (
          <span key={folder.id}>
            <span className="mx-2">/</span>
            <a className="text-text-muted hover:text-text" href={`/folder/${folder.slug}`}>
              {folder.name}
            </a>
          </span>
        ))}
        <span className="mx-2">/</span>
        <a className="text-text-muted hover:text-text" href={libraryHref}>
          {file.name}
        </a>
        <span className="mx-2">/</span>
        <span>{texture.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-4 max-sm:flex-col">
        <h1 className="text-xl font-normal">{texture.name}</h1>
        {!luckyContext && (
          <LuckyButton
            wadFileId={file.id}
            sourceLabel={file.name}
            context={wadContext}
            excludeHref={textureHref}
            label="Random texture"
            className="btn"
          />
        )}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6 max-md:grid-cols-1">
        <div className="min-h-[420px] border border-border-light bg-[#fafafa] flex items-center justify-center p-6">
          <img
            src={imageUrl}
            alt={texture.name}
            className="max-w-full max-h-[70vh] object-contain block"
            style={{ imageRendering: "pixelated" }}
          />
        </div>

        <aside className="card self-start">
          <h2 className="font-medium mb-4">Texture details</h2>
          <dl>
            <dt className="text-xs text-text-muted uppercase tracking-wide">Dimensions</dt>
            <dd className="mb-3">
              {texture.width} × {texture.height}
            </dd>

            <dt className="text-xs text-text-muted uppercase tracking-wide">Transparency</dt>
            <dd className="mb-3">{texture.isTransparent ? "Masked" : "Opaque"}</dd>

            <dt className="text-xs text-text-muted uppercase tracking-wide">Library</dt>
            <dd className="mb-3">
              <a href={libraryHref}>{file.name}</a>
            </dd>

            <dt className="text-xs text-text-muted uppercase tracking-wide">Format</dt>
            <dd className="mb-3">{contents.version}</dd>
          </dl>

          <div className="mt-6 flex flex-col gap-2">
            <a
              href={imageUrl}
              className="btn btn-primary text-center"
              download={`${texture.name}.png`}
            >
              Download PNG
            </a>
            <a href={`/uploads/${file.path}`} className="btn text-center" download>
              Download original WAD
            </a>
          </div>
        </aside>
      </div>
    </main>
  );
}

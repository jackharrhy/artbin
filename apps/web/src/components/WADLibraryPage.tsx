import { useState } from "react";
import type { WADContents } from "@artbin/core/parsers/wad";

import { LuckyButton } from "./LuckyButton";
import { getWADTextureHref } from "~/lib/wad-paths";

interface WADLibraryPageProps {
  file: { id: string; path: string; name: string; size: number };
  contents: WADContents;
  folderTrail: Array<{ id: string; name: string; slug: string }>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WADLibraryPage({ file, contents, folderTrail }: WADLibraryPageProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const textures = contents.textures.filter((texture) =>
    texture.name.toLowerCase().includes(normalizedQuery),
  );

  return (
    <main className="max-w-[1400px] mx-auto p-4 bg-bg min-h-[calc(100vh-48px)]">
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
        <span>{file.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5 max-sm:flex-col">
        <div>
          <h1 className="text-xl font-normal mb-1">{file.name}</h1>
          <p className="text-sm text-text-muted">
            {contents.version} texture library with {contents.textures.length}{" "}
            {contents.textures.length === 1 ? "texture" : "textures"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {contents.textures.length > 0 && (
            <LuckyButton
              wadFileId={file.id}
              sourceLabel={file.name}
              label="Random texture"
              className="btn"
            />
          )}
          <a href={`/uploads/${file.path}`} className="btn btn-primary" download>
            Download WAD
          </a>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4 max-sm:items-stretch max-sm:flex-col">
        <span className="text-xs text-text-muted">
          {normalizedQuery ? `${textures.length} matching` : contents.textures.length}{" "}
          {textures.length === 1 ? "texture" : "textures"}
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="input w-full max-w-xs"
          placeholder="Search textures"
          aria-label="Search WAD textures"
        />
      </div>

      {textures.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
          {textures.map((texture) => {
            const imageUrl = `/api/wad/${file.id}/texture/${texture.index}`;
            return (
              <a
                key={texture.index}
                href={getWADTextureHref(file.path, texture, contents.textures)}
                className="group border border-border-light bg-bg no-underline hover:border-border"
              >
                <div className="aspect-square overflow-hidden bg-bg-hover">
                  <img
                    src={imageUrl}
                    alt={texture.name}
                    loading="lazy"
                    className="w-full h-full object-contain block"
                    style={{ imageRendering: "pixelated" }}
                  />
                </div>
                <div className="px-2 py-2 border-t border-border-light">
                  <div className="truncate text-xs text-text">{texture.name}</div>
                  <div className="text-[0.68rem] text-text-faint">
                    {texture.width} × {texture.height}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="border border-border-light p-12 text-center text-text-muted">
          {normalizedQuery
            ? "No textures match this search."
            : "This WAD has no readable textures."}
        </div>
      )}

      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm max-sm:grid-cols-1 max-sm:gap-y-1">
        <dt className="text-text-muted">Original file</dt>
        <dd>
          <code className="text-xs">{file.path}</code>
        </dd>
        <dt className="text-text-muted">Size</dt>
        <dd>{formatSize(file.size)}</dd>
        <dt className="text-text-muted">Format</dt>
        <dd>{contents.version}</dd>
      </dl>
    </main>
  );
}

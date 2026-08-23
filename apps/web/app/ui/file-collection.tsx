import type { Handle } from "remix/ui";

import { routes } from "../routes.ts";

export interface FileItem {
  id: string;
  path: string;
  name: string;
  kind: string | null;
  mimeType: string;
  size: number;
  hasPreview?: boolean | null;
  width?: number | null;
  height?: number | null;
}

interface FileCollectionProps {
  files: FileItem[];
  grid?: boolean;
  showAudioPlayers?: boolean;
  nextHref?: string | null;
}

const playableAudio = new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]);

export function FileCollection(handle: Handle<FileCollectionProps>) {
  return () => {
    const { files, grid = false, showAudioPlayers = true, nextHref } = handle.props;
    if (files.length === 0) {
      return <div className="text-center p-12 text-text-muted">No files found.</div>;
    }

    return (
      <div>
        {grid ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {files.map((file) => (
              <a
                key={file.id}
                href={routes.file.href({ path: file.path })}
                className="group relative aspect-square overflow-hidden border border-border-light bg-[#f9f9f9] transition-colors hover:border-border"
              >
                <img
                  src={`/uploads/${file.path}${file.hasPreview ? ".preview.png" : ""}`}
                  alt={file.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 truncate bg-white/95 px-2 py-1 text-[0.7rem] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                  {file.name}
                  {file.width && file.height ? (
                    <span className="ml-2 opacity-70">
                      {file.width}×{file.height}
                    </span>
                  ) : null}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="border border-border-light bg-bg">
            {files.map((file) => {
              const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
              const canPlay =
                file.kind === "audio" && showAudioPlayers && playableAudio.has(extension);
              return (
                <div key={file.id} className="border-b border-border-light last:border-b-0">
                  <a
                    href={routes.file.href({ path: file.path })}
                    className="flex items-center gap-3 p-3 no-underline text-inherit transition-colors duration-150 hover:bg-bg-hover hover:no-underline"
                  >
                    <span className="shrink-0 text-2xl">{fileIcon(file.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{file.name}</div>
                      <div className="text-xs text-text-muted">
                        {file.kind} · {formatSize(file.size)}
                      </div>
                    </div>
                  </a>
                  {canPlay ? (
                    <div className="px-3 pb-3">
                      <audio
                        controls
                        src={`/uploads/${file.path}`}
                        preload="none"
                        className="h-8 w-full"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {nextHref ? (
          <div className="p-8 text-center">
            <a href={nextHref} className="btn">
              Load more
            </a>
          </div>
        ) : null}
      </div>
    );
  };
}

function fileIcon(kind: string | null): string {
  return (
    {
      texture: "🖼️",
      model: "📦",
      audio: "🔊",
      map: "🗺️",
      archive: "📁",
      config: "📄",
    }[kind ?? ""] ?? "📎"
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

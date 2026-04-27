import { useEffect, useRef } from "react";

// Browser-compatible extname
function extname(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return "";
  return filename.slice(lastDot);
}

interface FileItem {
  id: string;
  path: string;
  name: string;
  kind: string | null;
  mimeType: string;
  size: number;
  hasPreview?: boolean | null;
}

interface FileListProps {
  files: FileItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  showAudioPlayers?: boolean;
}

// Audio formats that browsers can play natively
const WEB_PLAYABLE_AUDIO = new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]);

function isWebPlayableAudio(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return WEB_PLAYABLE_AUDIO.has(ext);
}

function getFileIcon(kind: string | null): string {
  switch (kind) {
    case "texture":
      return "🖼️";
    case "model":
      return "📦";
    case "audio":
      return "🔊";
    case "map":
      return "🗺️";
    case "archive":
      return "📁";
    case "config":
      return "📄";
    default:
      return "📎";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({
  files,
  hasMore,
  onLoadMore,
  loading,
  showAudioPlayers = true,
}: FileListProps) {
  const loaderRef = useRef<HTMLDivElement>(null);

  // Infinite scroll with Intersection Observer
  useEffect(() => {
    if (!hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (files.length === 0) {
    return <div className="text-center p-12 text-text-muted">No files found</div>;
  }

  return (
    <div>
      <div className="border border-border-light bg-bg">
        {files.map((file) => {
          const isAudio = file.kind === "audio";
          const canPlay = isAudio && showAudioPlayers && isWebPlayableAudio(file.name);
          const downloadUrl = `/uploads/${file.path}`;

          return (
            <div key={file.id} className="border-b border-border-light last:border-b-0">
              <a
                href={`/file/${file.path}`}
                className="flex items-center gap-3 p-3 no-underline text-inherit transition-colors duration-150 hover:bg-bg-hover hover:no-underline"
              >
                <span className="shrink-0 text-2xl">{getFileIcon(file.kind)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{file.name}</div>
                  <div className="text-xs text-text-muted">
                    {file.kind} • {formatSize(file.size)}
                  </div>
                </div>
              </a>

              {canPlay && (
                <div className="px-3 pb-3">
                  <audio controls src={downloadUrl} preload="none" className="h-8 w-full" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Infinite scroll trigger */}
      {hasMore && (
        <div ref={loaderRef} className="p-8 text-center text-sm text-text-muted">
          {loading ? <span>Loading...</span> : <span>Scroll for more</span>}
        </div>
      )}
    </div>
  );
}

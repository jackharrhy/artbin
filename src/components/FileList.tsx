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
const WEB_PLAYABLE_AUDIO = ["mp3", "ogg", "wav", "m4a", "webm", "aac"];

function isWebPlayableAudio(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return WEB_PLAYABLE_AUDIO.includes(ext);
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

export function FileList({ files, hasMore, onLoadMore, loading, showAudioPlayers = true }: FileListProps) {
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
      { threshold: 0.1 }
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (files.length === 0) {
    return <div className="empty-state">No files found</div>;
  }

  return (
    <div>
      <div className="file-list-container">
        {files.map((file) => {
          const isAudio = file.kind === "audio";
          const canPlay = isAudio && showAudioPlayers && isWebPlayableAudio(file.name);
          const downloadUrl = `/uploads/${file.path}`;

          return (
            <div key={file.id} className="file-list-item">
              <a
                href={`/file/${file.path}`}
                className="file-list-link"
              >
                <span className="file-list-icon">
                  {getFileIcon(file.kind)}
                </span>
                <div className="file-list-info">
                  <div className="file-list-name">{file.name}</div>
                  <div className="file-list-meta">
                    {file.kind} • {formatSize(file.size)}
                  </div>
                </div>
              </a>

              {canPlay && (
                <div className="file-list-audio">
                  <audio
                    controls
                    src={downloadUrl}
                    preload="none"
                    className="file-list-audio-player"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Infinite scroll trigger */}
      {hasMore && (
        <div ref={loaderRef} className="load-more-trigger">
          {loading ? (
            <span>Loading...</span>
          ) : (
            <span>Scroll for more</span>
          )}
        </div>
      )}

      <style>{`
        .file-list-container {
          border: 1px solid var(--color-border-light);
          background: #fff;
        }

        .file-list-item {
          border-bottom: 1px solid var(--color-border-light);
        }

        .file-list-item:last-child {
          border-bottom: none;
        }

        .file-list-link {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          text-decoration: none;
          color: inherit;
          transition: background-color 0.15s;
        }

        .file-list-link:hover {
          background-color: var(--color-bg-hover);
          text-decoration: none;
        }

        .file-list-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .file-list-info {
          flex: 1;
          min-width: 0;
        }

        .file-list-name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-list-meta {
          font-size: 0.75rem;
          color: var(--color-text-muted);
        }

        .file-list-audio {
          padding: 0 0.75rem 0.75rem;
        }

        .file-list-audio-player {
          width: 100%;
          height: 32px;
        }

        .load-more-trigger {
          text-align: center;
          padding: 2rem;
          color: var(--color-text-muted);
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

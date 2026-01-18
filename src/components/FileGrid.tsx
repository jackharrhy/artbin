import { useEffect, useRef, useCallback } from "react";

interface FileItem {
  id: string;
  path: string;
  name: string;
  kind: string | null;
  hasPreview: boolean | null;
  width?: number | null;
  height?: number | null;
}

interface FileGridProps {
  files: FileItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
}

function getDisplayUrl(file: FileItem): string {
  if (file.hasPreview) {
    return `/uploads/${file.path}.preview.png`;
  }
  return `/uploads/${file.path}`;
}

export function FileGrid({ files, hasMore, onLoadMore, loading }: FileGridProps) {
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
      <div className="texture-grid">
        {files.map((file) => (
          <a
            key={file.id}
            href={`/file/${file.path}`}
            className="texture-card"
          >
            <img
              src={getDisplayUrl(file)}
              alt={file.name}
              loading="lazy"
            />
            <div className="texture-card-info">
              {file.name}
              {file.width && file.height && (
                <span style={{ marginLeft: "0.5rem", opacity: 0.7 }}>
                  {file.width}×{file.height}
                </span>
              )}
            </div>
          </a>
        ))}
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

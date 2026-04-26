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
      { threshold: 0.1 },
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {files.map((file) => (
          <a
            key={file.id}
            href={`/file/${file.path}`}
            className="group relative aspect-square overflow-hidden border border-border-light bg-[#f9f9f9] transition-colors hover:border-border"
          >
            <img
              src={getDisplayUrl(file)}
              alt={file.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 truncate bg-white/95 px-2 py-1 text-[0.7rem] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
              {file.name}
              {file.width && file.height && (
                <span className="ml-2 opacity-70">
                  {file.width}×{file.height}
                </span>
              )}
            </div>
          </a>
        ))}
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

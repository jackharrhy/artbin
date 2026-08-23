import { useEffect, useMemo, useRef } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";

export interface LuckyContext {
  sourceHref: string;
  sourceLabel: string;
  folderId?: string;
  wadFileId?: string;
}

interface LuckyResponse {
  href?: string;
  error?: string;
}

interface LuckyButtonProps {
  folderId?: string;
  wadFileId?: string;
  sourceLabel: string;
  context?: LuckyContext;
  excludeHref?: string;
  replace?: boolean;
  label?: string;
  className?: string;
}

export function getLuckyContext(state: unknown): LuckyContext | null {
  if (!state || typeof state !== "object" || !("lucky" in state)) return null;

  const lucky = (state as { lucky?: unknown }).lucky;
  if (!lucky || typeof lucky !== "object") return null;

  const candidate = lucky as Partial<LuckyContext>;
  if (
    typeof candidate.sourceHref !== "string" ||
    !candidate.sourceHref.startsWith("/") ||
    typeof candidate.sourceLabel !== "string" ||
    (candidate.folderId !== undefined && typeof candidate.folderId !== "string") ||
    (candidate.wadFileId !== undefined && typeof candidate.wadFileId !== "string")
  ) {
    return null;
  }

  return {
    sourceHref: candidate.sourceHref,
    sourceLabel: candidate.sourceLabel,
    folderId: candidate.folderId,
    wadFileId: candidate.wadFileId,
  };
}

export function LuckyButton({
  folderId,
  wadFileId,
  sourceLabel,
  context,
  excludeHref,
  replace = false,
  label = "I'm feeling lucky",
  className = "text-sm text-text-muted hover:text-text bg-transparent border-0 p-0 cursor-pointer whitespace-nowrap",
}: LuckyButtonProps) {
  const fetcher = useFetcher<LuckyResponse>();
  const location = useLocation();
  const navigate = useNavigate();
  const handledResponse = useRef<LuckyResponse | undefined>(undefined);

  const luckyContext: LuckyContext = useMemo(
    () =>
      context ?? {
        sourceHref: `${location.pathname}${location.search}`,
        sourceLabel,
        folderId,
        wadFileId,
      },
    [context, folderId, location.pathname, location.search, sourceLabel, wadFileId],
  );

  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      !fetcher.data?.href ||
      handledResponse.current === fetcher.data
    ) {
      return;
    }

    handledResponse.current = fetcher.data;
    navigate(fetcher.data.href, {
      replace,
      state: { lucky: luckyContext },
    });
  }, [fetcher.data, fetcher.state, luckyContext, navigate, replace]);

  const isLoading = fetcher.state !== "idle";

  return (
    <span className="inline-flex items-center gap-2">
      <fetcher.Form method="post" action="/api/lucky" className="inline">
        {folderId && <input type="hidden" name="folderId" value={folderId} />}
        {wadFileId && <input type="hidden" name="wadFileId" value={wadFileId} />}
        {excludeHref && <input type="hidden" name="excludeHref" value={excludeHref} />}
        <button type="submit" className={className} disabled={isLoading}>
          {isLoading ? "Finding something…" : label}
        </button>
      </fetcher.Form>
      {fetcher.data?.error && fetcher.state === "idle" && (
        <span role="alert" className="text-xs text-red-600">
          {fetcher.data.error}
        </span>
      )}
    </span>
  );
}

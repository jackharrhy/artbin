import { useSearchParams } from "react-router";

export type ViewMode = "folders" | "textures" | "models" | "sounds" | "all";

interface BrowseTabsProps {
  baseUrl: string;
  currentView: ViewMode;
  counts?: {
    folders?: number;
    textures?: number;
    models?: number;
    sounds?: number;
    all?: number;
  };
}

const TABS: { id: ViewMode; label: string }[] = [
  { id: "folders", label: "Folders" },
  { id: "textures", label: "Textures" },
  { id: "models", label: "Models" },
  { id: "sounds", label: "Sounds" },
  { id: "all", label: "All Files" },
];

export function BrowseTabs({ baseUrl, currentView, counts }: BrowseTabsProps) {
  return (
    <div className="browse-tabs">
      {TABS.map((tab) => {
        const isActive = currentView === tab.id;
        const href = tab.id === "folders" ? baseUrl : `${baseUrl}?view=${tab.id}`;
        const count = counts?.[tab.id];

        return (
          <a
            key={tab.id}
            href={href}
            className={`browse-tab ${isActive ? "browse-tab-active" : ""}`}
          >
            {tab.label}
            {count !== undefined && (
              <span className="browse-tab-count">{count}</span>
            )}
          </a>
        );
      })}

      <style>{`
        .browse-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--color-border-light);
          margin-bottom: 1rem;
        }

        .browse-tab {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
          text-decoration: none;
          color: var(--color-text-muted);
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.15s, border-color 0.15s;
        }

        .browse-tab:hover {
          color: var(--color-text);
          text-decoration: none;
        }

        .browse-tab-active {
          color: var(--color-text);
          border-bottom-color: var(--color-text);
        }

        .browse-tab-count {
          margin-left: 0.375rem;
          font-size: 0.75rem;
          color: var(--color-text-muted);
        }

        .browse-tab-active .browse-tab-count {
          color: var(--color-text);
        }
      `}</style>
    </div>
  );
}

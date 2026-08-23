import type { Handle } from "remix/ui";

export type ViewMode = "folders" | "textures" | "models" | "sounds" | "all";

interface BrowseTabsProps {
  baseUrl: string;
  currentView: ViewMode;
  counts: Partial<Record<ViewMode, number>>;
}

const tabs: { id: ViewMode; label: string }[] = [
  { id: "folders", label: "Folders" },
  { id: "textures", label: "Textures" },
  { id: "models", label: "Models" },
  { id: "sounds", label: "Sounds" },
  { id: "all", label: "All files" },
];

export function BrowseTabs(handle: Handle<BrowseTabsProps>) {
  return () => {
    const { baseUrl, currentView, counts } = handle.props;
    return (
      <nav className="flex border-b border-border-light mb-4" aria-label="Browse by type">
        {tabs.map((tab) => {
          const active = currentView === tab.id;
          const href = tab.id === "folders" ? baseUrl : `${baseUrl}?view=${tab.id}`;
          return (
            <a
              key={tab.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`px-4 py-2 text-sm no-underline -mb-px border-b-2 transition-colors duration-150 ${
                active
                  ? "text-text border-text"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              {tab.label}
              {counts[tab.id] === undefined ? null : (
                <span className="ml-1.5 text-xs text-text-muted">{counts[tab.id]}</span>
              )}
            </a>
          );
        })}
      </nav>
    );
  };
}

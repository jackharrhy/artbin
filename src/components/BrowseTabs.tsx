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
    <div className="flex border-b border-border-light mb-4">
      {TABS.map((tab) => {
        const isActive = currentView === tab.id;
        const href = tab.id === "folders" ? baseUrl : `${baseUrl}?view=${tab.id}`;
        const count = counts?.[tab.id];

        return (
          <a
            key={tab.id}
            href={href}
            className={`px-4 py-2 text-sm no-underline -mb-px border-b-2 transition-colors duration-150 ${
              isActive
                ? "text-text border-text"
                : "text-text-muted border-transparent hover:text-text"
            }`}
          >
            {tab.label}
            {count !== undefined && (
              <span className={`ml-1.5 text-xs ${isActive ? "text-text" : "text-text-muted"}`}>
                {count}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

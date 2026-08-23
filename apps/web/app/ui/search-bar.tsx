import type { Handle } from "remix/ui";

interface SearchBarProps {
  action: string;
  currentView: string;
  currentQuery: string;
  currentTag: string | null;
  tags: { id: string; name: string; slug: string }[];
}

export function SearchBar(handle: Handle<SearchBarProps>) {
  return () => {
    const { action, currentView, currentQuery, currentTag, tags } = handle.props;
    const clearHref = `${action}?view=${encodeURIComponent(currentView)}`;

    return (
      <form method="get" action={action} className="flex gap-2 items-center flex-wrap mb-4">
        <input type="hidden" name="view" value={currentView} />
        <div className="flex gap-2 flex-1 min-w-[200px] max-w-[400px]">
          <label className="sr-only" htmlFor="browse-search">
            Search {currentView}
          </label>
          <input
            id="browse-search"
            type="search"
            name="q"
            value={currentQuery}
            placeholder={`Search ${currentView}`}
            className="input flex-1"
          />
          <button type="submit" className="btn">
            Search
          </button>
        </div>
        {tags.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="browse-tag">
              Filter by tag
            </label>
            <select id="browse-tag" name="tag" className="input min-w-[120px]">
              <option value="" selected={!currentTag}>
                All tags
              </option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.slug} selected={currentTag === tag.slug}>
                  {tag.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-sm">
              Apply
            </button>
          </>
        ) : null}
        {currentQuery || currentTag ? (
          <a href={clearHref} className="btn btn-sm text-text-muted">
            Clear filters
          </a>
        ) : null}
      </form>
    );
  };
}

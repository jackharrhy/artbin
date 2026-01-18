import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";

interface SearchBarProps {
  baseUrl: string;
  currentView: string;
  currentQuery: string;
  currentTag: string | null;
  tags?: { id: string; name: string; slug: string }[];
  placeholder?: string;
}

export function SearchBar({
  baseUrl,
  currentView,
  currentQuery,
  currentTag,
  tags = [],
  placeholder = "Search files...",
}: SearchBarProps) {
  const [query, setQuery] = useState(currentQuery);
  const navigate = useNavigate();

  // Update local state when prop changes (e.g., navigating)
  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (currentView !== "folders") params.set("view", currentView);
    if (query.trim()) params.set("q", query.trim());
    if (currentTag) params.set("tag", currentTag);
    
    const search = params.toString();
    navigate(`${baseUrl}${search ? `?${search}` : ""}`);
  };

  const handleTagChange = (tagSlug: string) => {
    const params = new URLSearchParams();
    if (currentView !== "folders") params.set("view", currentView);
    if (query.trim()) params.set("q", query.trim());
    if (tagSlug) params.set("tag", tagSlug);
    
    const search = params.toString();
    navigate(`${baseUrl}${search ? `?${search}` : ""}`);
  };

  const clearFilters = () => {
    const params = new URLSearchParams();
    if (currentView !== "folders") params.set("view", currentView);
    
    const search = params.toString();
    navigate(`${baseUrl}${search ? `?${search}` : ""}`);
  };

  const hasFilters = query.trim() || currentTag;

  return (
    <div className="search-bar">
      <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="input search-input"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      {tags.length > 0 && (
        <select
          value={currentTag || ""}
          onChange={(e) => handleTagChange(e.target.value)}
          className="input tag-select"
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.slug}>
              {tag.name}
            </option>
          ))}
        </select>
      )}

      {hasFilters && (
        <button onClick={clearFilters} className="btn btn-sm clear-btn">
          Clear filters
        </button>
      )}

      <style>{`
        .search-bar {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }

        .search-form {
          display: flex;
          gap: 0.5rem;
          flex: 1;
          min-width: 200px;
          max-width: 400px;
        }

        .search-input {
          flex: 1;
        }

        .tag-select {
          min-width: 120px;
        }

        .clear-btn {
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
}

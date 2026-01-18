interface HeaderProps {
  user?: {
    username: string;
    isAdmin?: boolean | null;
  } | null;
  /** Optional callback when upload button is clicked (instead of navigating) */
  onUploadClick?: () => void;
}

export function Header({ user, onUploadClick }: HeaderProps) {
  return (
    <header className="header">
      <a href={user ? "/folders" : "/"} className="header-logo">
        artbin
      </a>
      <nav className="header-nav">
        {user ? (
          <>
            <a href="/folders" className="header-link">folders</a>
            {onUploadClick ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onUploadClick}
              >
                upload
              </button>
            ) : (
              <a href="/folders" className="btn btn-sm">upload</a>
            )}
            <a href="/settings" className="header-link">@{user.username}</a>
            {user.isAdmin && <span className="badge-admin">admin</span>}
          </>
        ) : (
          <>
            <a href="/login" className="header-link">login</a>
          </>
        )}
      </nav>
    </header>
  );
}

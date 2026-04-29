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
    <header className="sticky top-0 z-100 bg-bg border-b border-border-light flex items-center justify-between h-12 px-4">
      <a href={user ? "/folders" : "/"} className="text-lg tracking-wide no-underline text-text">
        artbin
      </a>
      <nav className="flex items-center gap-4">
        {user ? (
          <>
            <a href="/folders" className="text-sm no-underline text-text-muted hover:text-text">
              folders
            </a>
            {onUploadClick && (
              <button type="button" className="btn btn-sm" onClick={onUploadClick}>
                upload
              </button>
            )}
            <a href="/my-uploads" className="text-sm no-underline text-text-muted hover:text-text">
              my uploads
            </a>
            <a href="/settings" className="text-sm no-underline text-text-muted hover:text-text">
              @{user.username}
            </a>
            {user.isAdmin && (
              <>
                <a
                  href="/admin/inbox"
                  className="text-sm no-underline text-text-muted hover:text-text"
                >
                  inbox
                </a>
                <span className="badge-admin">admin</span>
              </>
            )}
          </>
        ) : (
          <>
            <a href="/login" className="text-sm no-underline text-text-muted hover:text-text">
              login
            </a>
          </>
        )}
      </nav>
    </header>
  );
}

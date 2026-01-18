import { Form } from "react-router";

interface HeaderProps {
  user?: {
    username: string;
    isAdmin?: boolean | null;
  } | null;
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="header">
      <a href={user ? "/folders" : "/"} className="header-logo">
        artbin
      </a>
      <nav className="header-nav">
        {user ? (
          <>
            <a href="/folders" className="header-link">folders</a>
            <a href="/upload" className="btn btn-sm">upload</a>
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

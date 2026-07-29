import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
import { currentUserAtom } from "../atoms/session";
import { useLogout } from "../api/hooks";

/** Minimal authed shell (top bar + outlet). The full sidebar layout lands in the
 *  layout flow; this is enough to host and navigate the authed routes. */
export function AppShell() {
  const user = useAtomValue(currentUserAtom);
  const logout = useLogout();
  const navigate = useNavigate();

  function onSignOut() {
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold">Sedjiwa · Tasks</span>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/dashboard"
              className="rounded px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Dashboard
            </Link>
            <Link
              to="/projects"
              className="rounded px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Projects
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <span className="flex items-center gap-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">
                {getInitials(user.displayName)}
              </span>
              {user.displayName}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

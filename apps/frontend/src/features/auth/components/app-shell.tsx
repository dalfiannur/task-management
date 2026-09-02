import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ChevronsUpDown,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn, getInitials } from "@/lib/utils";
import { APP_NAME } from "@/lib/app-config";
import { NotificationBell } from "@/features/notifications";
import { SearchOverlay, searchOpenAtom } from "@/features/search";
import { currentUserAtom, isAdminAtom } from "../atoms/session";
import { useLogout } from "../api/hooks";

const NAV: { to: string; label: string; icon: LucideIcon; adminOnly?: boolean }[] =
  [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/my-tasks", label: "My tasks", icon: ListTodo },
    { to: "/settings/tokens", label: "Access tokens", icon: KeyRound },
    // Hidden rather than disabled for non-admins: a greyed-out entry would
    // advertise a page they can never open. The route guards itself too, and
    // the server refuses the RPCs regardless.
    { to: "/admin/users", label: "Users", icon: ShieldCheck, adminOnly: true },
  ];

/** Authed shell: sidebar navigation + a thin action bar over the outlet.
 *
 *  Sidebar memakai keluarga CHROME berwarna brand. Dua aturan dilonggarkan
 *  untuk ini, keduanya tercatat di spec: §2 (permukaan ketiga) dan §3.6
 *  (biru dicadangkan untuk aksi). Konsekuensi yang diterima sadar: tombol
 *  primer bukan lagi satu-satunya biru di layar.
 *
 *  TIDAK ADA satu pun token teks/permukaan netral yang boleh dipakai di dalam
 *  sidebar. Semuanya terukur dan tiga di antaranya terlarang keras:
 *   · --text di atas chrome = 1.11:1 (light) — nyaris tak terlihat.
 *   · --text-muted di atas chrome = 2.57:1.
 *   · --brand-text di atas chrome = 2.32:1 — inilah sebabnya pil aktif TIDAK
 *     bisa memakai --brand-subtle/--brand-text seperti di seluruh aplikasi.
 *  Pakai --text-on-chrome (14.33) dan --text-on-chrome-muted (7.50); pil aktif
 *  memakai --surface-chrome-active dengan --text-on-chrome (9.72).
 *  CATATAN: utilitas Tailwind-nya `text-text-on-chrome` (dari --color-text-on-
 *  chrome), sama polanya dengan `text-text-on-brand`. Menulis `text-on-chrome`
 *  menghasilkan kelas yang TIDAK ADA — lolos build, lolos lint, dan warnanya
 *  diam-diam tidak diterapkan.
 *
 *  Sidebar sticky setinggi layar sementara window yang menggulir, jadi ia tidak
 *  butuh scroll container sendiri. */
export function AppShell() {
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const logout = useLogout();
  const navigate = useNavigate();
  // Action bar duduk di atas kanvas dengan warna yang sama dan tanpa border,
  // jadi tidak ada apa pun yang menandai batasnya saat konten lewat di
  // bawahnya. Bayangan ini menggantikan border yang sengaja dilepas.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function onSignOut() {
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <SearchOverlay />
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-surface-chrome">
        <span className="flex h-14 items-center px-5 font-semibold text-text-on-chrome">
          {APP_NAME}
        </span>

        <nav className="flex flex-col gap-1 px-3 text-sm">
          {NAV.filter((n) => !n.adminOnly || isAdmin).map(
            ({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              // Semua WARNA di activeProps/inactiveProps, tidak satu pun di
              // className dasar — TanStack Router MENGGABUNGKAN keduanya, jadi
              // utility berspesifisitas sama diadu oleh urutan sumber CSS.
              className="flex items-center gap-2.5 rounded-full px-3 py-2 transition-colors [transition-duration:var(--duration-fast)]"
              activeProps={{
                className: "bg-surface-chrome-active text-text-on-chrome font-semibold",
              }}
              inactiveProps={{
                className: "text-text-on-chrome-muted hover:bg-surface-chrome-hover hover:text-text-on-chrome",
              }}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {user && (
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm text-text-on-chrome transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-chrome-hover"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-chrome-active text-xs text-text-on-chrome">
                    {getInitials(user.displayName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {user.displayName}
                  </span>
                  <ChevronsUpDown
                    className="h-3.5 w-3.5 shrink-0 text-text-on-chrome-muted"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              {/* Sign out jarang dipakai tapi dulu menempati ruang tetap di
                  top bar. Di menu ia tetap satu klik dari mana saja. */}
              <DropdownMenuContent align="start" className="w-[13rem]">
                <DropdownMenuItem onSelect={onSignOut}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 bg-surface px-4",
            "transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
            scrolled && "shadow-1",
          )}
        >
          <Button
            variant="outline"
            size="sm"
            className="w-56 justify-start text-text-muted hover:text-text"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4" />
            Search…
            {/* kbd hint sits on --surface-sunken, so its own text is
                --text-muted (tier 2) — --text-subtle on sunken fails
                contrast in light mode (accessibility.md). */}
            <span className="ml-auto flex items-center gap-0.5">
              <kbd className="rounded border border-border bg-surface-sunken px-1 text-xs font-sans text-text-muted">
                ⌘
              </kbd>
              <kbd className="rounded border border-border bg-surface-sunken px-1 text-xs font-sans text-text-muted">
                K
              </kbd>
            </span>
          </Button>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  ChevronsUpDown,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { currentUserAtom } from "../atoms/session";
import { useLogout } from "../api/hooks";

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/my-tasks", label: "My tasks", icon: ListTodo },
];

/** Authed shell: sidebar navigation + a thin action bar over the outlet.
 *
 *  Sidebar memakai --surface-sunken, BUKAN permukaan baru: aturan §2 melarang
 *  permukaan ketiga, dan putih sudah berarti konten. Sunken adalah token yang
 *  sudah ada — chrome duduk di wilayah tenggelam, konten mengambang di atasnya
 *  dengan kartu putih. Tetap tanpa garis pemisah.
 *
 *  Tiga konsekuensi yang HARUS ikut, semuanya terukur:
 *   · hover nav TIDAK boleh --surface-hover — di atas sunken ia 1.07:1, praktis
 *     tak terlihat. Ia naik ke --surface-raised (1.23 light / 1.46 dark).
 *   · chip avatar tidak boleh --surface-sunken — sunken di atas sunken = 1.00:1.
 *   · chevron tidak boleh --text-subtle — pasangan itu DILARANG di atas
 *     --surface-sunken (4.18:1 di light, lihat tokens.css).
 *
 *  Sidebar sticky setinggi layar sementara window yang menggulir, jadi ia tidak
 *  butuh scroll container sendiri. */
export function AppShell() {
  const user = useAtomValue(currentUserAtom);
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
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-surface-sunken">
        <span className="flex h-14 items-center px-5 font-semibold">
          {APP_NAME}
        </span>

        <nav className="flex flex-col gap-1 px-3 text-sm">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              // Semua WARNA di activeProps/inactiveProps, tidak satu pun di
              // className dasar — TanStack Router MENGGABUNGKAN keduanya, jadi
              // utility berspesifisitas sama diadu oleh urutan sumber CSS.
              className="flex items-center gap-2.5 rounded-full px-3 py-2 transition-colors [transition-duration:var(--duration-fast)]"
              activeProps={{
                className: "bg-brand-subtle text-brand-text font-semibold",
              }}
              inactiveProps={{
                className: "text-text-muted hover:bg-surface-raised hover:text-text",
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
                  className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-raised"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs">
                    {getInitials(user.displayName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {user.displayName}
                  </span>
                  <ChevronsUpDown
                    className="h-3.5 w-3.5 shrink-0 text-text-muted"
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
            "sticky top-0 z-40 flex h-14 shrink-0 items-center justify-end gap-3 bg-surface px-4",
            "transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
            scrolled && "shadow-1",
          )}
        >
          <ThemeToggle />
          <NotificationBell />
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

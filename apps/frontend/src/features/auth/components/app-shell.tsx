import { Fragment, useEffect, useState, type ReactElement } from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronsUpDown,
  FileBarChart,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn, getInitials } from "@/lib/utils";
import { APP_NAME } from "@/lib/app-config";
import { NotificationBell } from "@/features/notifications";
import { useProject } from "@/features/projects";
import { SearchOverlay, searchOpenAtom } from "@/features/search";
import { currentUserAtom, isAdminAtom } from "../atoms/session";
import { mobileNavOpenAtom, sidebarCollapsedAtom } from "../atoms/sidebar";
import { useLogout } from "../api/hooks";

type NavItem = { to: string; label: string; icon: LucideIcon };

const WORKSPACE_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/my-tasks", label: "My tasks", icon: ListTodo },
  { to: "/reports", label: "Reports", icon: FileBarChart },
];

// Hidden rather than disabled for non-admins: a greyed-out entry would
// advertise a page they can never open. The route guards itself too, and the
// server refuses the RPCs regardless.
const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "Users", icon: ShieldCheck },
];

// Access tokens lives in the user menu, not the nav, but still needs a
// breadcrumb label.
const SECTIONS: { to: string; label: string }[] = [
  ...WORKSPACE_NAV,
  ...ADMIN_NAV,
  { to: "/settings/tokens", label: "Access tokens" },
];

/** Authed shell: collapsible sidebar (a drawer below `md`) + an action bar
 *  carrying the breadcrumb over the outlet.
 *
 *  Sidebar duduk di --surface-sunken — satu-satunya jawaban legal untuk
 *  permukaan berbeda (spec §2), dan biru kembali hanya untuk aksi (§3.6).
 *  Pasangan warnanya terukur (lihat 4b3fbb8), jangan ditukar sembarangan:
 *   · hover = --surface-raised; --surface-hover di atas sunken 1.07:1, tak
 *     terlihat.
 *   · chip avatar = --surface-raised; sunken di atas sunken 1.00:1.
 *   · teks sekunder = --text-muted; --text-subtle DILARANG di atas sunken.
 *  Drawer mobile memakai permukaan yang sama agar semua pasangan ini tetap
 *  berlaku di sana.
 *
 *  Sidebar sticky setinggi layar sementara window yang menggulir, jadi ia tidak
 *  butuh scroll container sendiri. */
export function AppShell() {
  const collapsed = useAtomValue(sidebarCollapsedAtom);
  const [mobileOpen, setMobileOpen] = useAtom(mobileNavOpenAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen bg-surface">
        <SearchOverlay />
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col bg-surface-sunken md:flex print:hidden",
            "transition-[width] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
            collapsed ? "w-14" : "w-56",
          )}
        >
          <SidebarContent collapsed={collapsed} />
        </aside>

        {/* Drawer hanya punya jalan masuk dari hamburger `md:hidden`, jadi
            tidak perlu disembunyikan di desktop. */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-64 gap-0 bg-surface-sunken print:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 bg-surface px-4 print:hidden",
              "transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
              scrolled && "shadow-1",
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-2 md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <ShellBreadcrumb />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-text-muted hover:text-text sm:w-56 sm:justify-start"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Search…</span>
              {/* kbd hint sits on --surface-sunken, so its own text is
                  --text-muted (tier 2) — --text-subtle on sunken fails
                  contrast in light mode (accessibility.md). */}
              <span className="ml-auto hidden items-center gap-0.5 sm:flex">
                <kbd className="rounded border border-border bg-surface-sunken px-1 text-xs font-sans text-text-muted">
                  ⌘
                </kbd>
                <kbd className="rounded border border-border bg-surface-sunken px-1 text-xs font-sans text-text-muted">
                  K
                </kbd>
              </span>
            </Button>
            <div className="flex shrink-0 items-center gap-3">
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Brand, grouped nav, collapse toggle and user menu. Rendered twice: in the
 *  desktop aside and in the mobile drawer (never collapsed there). */
function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const isAdmin = useAtomValue(isAdminAtom);
  const setCollapsed = useSetAtom(sidebarCollapsedAtom);
  // The toggle only exists on the desktop aside; the drawer has no rail mode.
  const collapsible = !onNavigate;

  return (
    <>
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5",
          collapsed ? "justify-center" : "px-5",
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-semibold text-text-on-brand"
        >
          {APP_NAME.charAt(0)}
        </span>
        <span
          className={cn(
            "truncate font-semibold text-text",
            collapsed && "sr-only",
          )}
        >
          {APP_NAME}
        </span>
      </div>

      <nav className="flex flex-col gap-4 px-3 pt-2 text-sm">
        <NavGroup
          label="Workspace"
          items={WORKSPACE_NAV}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        {isAdmin && (
          <NavGroup
            label="Admin"
            items={ADMIN_NAV}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-1 p-3">
        {collapsible && (
          <NavTooltip label="Expand sidebar" enabled={collapsed}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className={cn(
                "flex items-center gap-2.5 rounded-full py-2 text-sm text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-raised hover:text-text",
                collapsed ? "justify-center px-0" : "px-3",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {!collapsed && "Collapse"}
            </button>
          </NavTooltip>
        )}
        <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Collapsed rail has no room for a heading; a hairline keeps the
          grouping visible. --text-muted, not --text-subtle: it sits on
          --surface-sunken. */}
      {collapsed ? (
        <div aria-hidden="true" className="mx-2 mb-1 h-px bg-border" />
      ) : (
        <span className="px-3 pb-1 text-xs font-medium text-text-muted">
          {label}
        </span>
      )}
      {items.map(({ to, label: itemLabel, icon: Icon }) => (
        <NavTooltip key={to} label={itemLabel} enabled={collapsed}>
          <Link
            to={to}
            onClick={onNavigate}
            aria-label={collapsed ? itemLabel : undefined}
            // Semua WARNA di activeProps/inactiveProps, tidak satu pun di
            // className dasar — TanStack Router MENGGABUNGKAN keduanya, jadi
            // utility berspesifisitas sama diadu oleh urutan sumber CSS.
            className={cn(
              "flex items-center gap-2.5 rounded-full py-2 transition-colors [transition-duration:var(--duration-fast)]",
              collapsed ? "justify-center px-0" : "px-3",
            )}
            activeProps={{ className: "bg-brand-subtle text-brand-text font-semibold" }}
            inactiveProps={{ className: "text-text hover:bg-surface-raised" }}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && itemLabel}
          </Link>
        </NavTooltip>
      ))}
    </div>
  );
}

/** Label tooltip for the icon-only rail; a passthrough when expanded. */
function NavTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function UserMenu({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const user = useAtomValue(currentUserAtom);
  const logout = useLogout();
  const navigate = useNavigate();

  if (!user) return null;

  function onSignOut() {
    onNavigate?.();
    logout();
    navigate({ to: "/login" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={collapsed ? `Account: ${user.displayName}` : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-full py-2 text-left text-sm text-text transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-raised",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs">
            {getInitials(user.displayName)}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
              <ChevronsUpDown
                className="h-3.5 w-3.5 shrink-0 text-text-muted"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align={collapsed ? "end" : "start"}
        className="w-[13rem]"
      >
        <DropdownMenuLabel className="flex flex-col font-normal">
          <span className="truncate font-medium text-text">
            {user.displayName}
          </span>
          <span className="truncate text-xs text-text-muted">{user.phone}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/tokens" onClick={onNavigate}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Access tokens
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Section (and project, inside one) for the current route. The project read
 *  shares ProjectShell's query key, so it costs no extra request. */
function ShellBreadcrumb() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { projectId } = useParams({ strict: false });
  const { project, isError } = useProject(projectId ?? "");

  const section = SECTIONS.find(
    (s) => pathname === s.to || pathname.startsWith(`${s.to}/`),
  );

  const crumbs: { label: string; to?: string }[] = [];
  if (section) crumbs.push({ label: section.label, to: section.to });
  // A failed load is already explained by ProjectShell; don't leave a "…"
  // crumb hanging next to it.
  if (projectId && !isError) crumbs.push({ label: project?.name ?? "…" });

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className={cn(last && "min-w-0")}>
                {last ? (
                  <BreadcrumbPage className="truncate font-medium text-text">
                    {c.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={c.to!}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

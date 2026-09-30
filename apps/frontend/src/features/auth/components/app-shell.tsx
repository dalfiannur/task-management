import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Check,
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
  Plus,
  Search,
  ShieldCheck,
  X,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useAssignedOpenCount } from "@/features/dashboard";
import {
  PROJECT_STATUSES,
  useProject,
  useProjects,
  usePinnedProjects,
} from "@/features/projects";
import { SearchOverlay, searchOpenAtom } from "@/features/search";
import { currentUserAtom, isAdminAtom } from "../atoms/session";
import { mobileNavOpenAtom, sidebarCollapsedAtom } from "../atoms/sidebar";
import { useLogout } from "../api/hooks";

type NavItem = { to: string; label: string; icon: LucideIcon };

const MAIN_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-tasks", label: "My tasks", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban },
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
  ...MAIN_NAV,
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

/** Brand, nav, pinned projects, collapse toggle and user menu. Rendered twice:
 *  in the desktop aside and in the mobile drawer (never collapsed there). */
function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const isAdmin = useAtomValue(isAdminAtom);
  const setCollapsed = useSetAtom(sidebarCollapsedAtom);
  const openCount = useAssignedOpenCount();
  // The toggle only exists on the desktop aside; the drawer has no rail mode.
  const collapsible = !onNavigate;

  return (
    <>
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-semibold text-text-on-brand"
        >
          {APP_NAME.charAt(0)}
        </span>
        {/* Dua baris, bukan truncate: "Project Management" terpotong di w-56. */}
        <span
          className={cn(
            "line-clamp-2 text-sm font-semibold leading-tight text-text",
            collapsed && "sr-only",
          )}
        >
          {APP_NAME}
        </span>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-2 text-sm">
        <div className="flex flex-col gap-0.5">
          {MAIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
              badge={item.to === "/my-tasks" ? openCount : undefined}
            />
          ))}
        </div>

        <PinnedSection collapsed={collapsed} onNavigate={onNavigate} />

        {isAdmin && (
          <div className="flex flex-col gap-0.5">
            <SectionHeading label="Admin" collapsed={collapsed} />
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-0.5 p-3">
        {collapsible && (
          <NavTooltip label="Expand sidebar" enabled={collapsed}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className={cn(
                "flex items-center gap-2.5 rounded-md py-1.5 text-sm text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-raised hover:text-text",
                collapsed ? "justify-center px-0" : "px-2.5",
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

/** Group heading; the collapsed rail has no room for text, so a hairline keeps
 *  the grouping visible. --text-muted, not --text-subtle: it sits on
 *  --surface-sunken. */
function SectionHeading({
  label,
  collapsed,
  action,
}: {
  label: string;
  collapsed: boolean;
  action?: ReactNode;
}) {
  if (collapsed) {
    return <div aria-hidden="true" className="mx-2 mb-1.5 h-px bg-border" />;
  }
  return (
    <div className="flex h-6 items-center justify-between pr-1 pb-0.5 pl-2.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {action}
    </div>
  );
}

// Aktif = --surface-raised + bar brand 3px yang menempel di tepi sidebar
// (before:-left-3 membatalkan px-3 milik nav), ikon brand, teks medium. Hover
// hanya mengganti latar, jadi aktif dan hover tetap bisa dibedakan.
const ITEM_BASE =
  "relative flex items-center gap-2.5 rounded-md py-1.5 transition-colors [transition-duration:var(--duration-fast)]";
const ITEM_ACTIVE =
  "bg-surface-raised text-text font-medium [&>svg]:text-brand before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-brand";
const ITEM_INACTIVE = "text-text hover:bg-surface-raised [&>svg]:text-text-muted";

function NavLink({
  item: { to, label, icon: Icon },
  collapsed,
  onNavigate,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: number | null;
}) {
  const count = badge ?? 0;
  return (
    <NavTooltip label={count > 0 ? `${label} · ${count}` : label} enabled={collapsed}>
      <Link
        to={to}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        // Semua WARNA di activeProps/inactiveProps, tidak satu pun di
        // className dasar — TanStack Router MENGGABUNGKAN keduanya, jadi
        // utility berspesifisitas sama diadu oleh urutan sumber CSS.
        className={cn(ITEM_BASE, collapsed ? "justify-center px-0" : "px-2.5")}
        activeProps={{ className: ITEM_ACTIVE }}
        inactiveProps={{ className: ITEM_INACTIVE }}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {count > 0 &&
          (collapsed ? (
            <span
              aria-hidden="true"
              className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-brand"
            />
          ) : (
            <span className="text-num text-xs text-text-muted">
              {count > 99 ? "99+" : count}
              <span className="sr-only"> open</span>
            </span>
          ))}
      </Link>
    </NavTooltip>
  );
}

function PinnedSection({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { ids } = usePinnedProjects();
  // Nothing to show in the rail, and the rail has no room for the picker.
  if (collapsed && ids.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <SectionHeading
        label="Pinned"
        collapsed={collapsed}
        action={<PinProjectPicker />}
      />
      {ids.length === 0 ? (
        <p className="px-2.5 text-xs text-text-muted">
          Pin a project for one-click access.
        </p>
      ) : (
        ids.map((id) => (
          <PinnedProjectLink
            key={id}
            id={id}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))
      )}
    </div>
  );
}

function PinnedProjectLink({
  id,
  collapsed,
  onNavigate,
}: {
  id: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { project, isError } = useProject(id);
  const { unpin } = usePinnedProjects();
  // Deleted, or no longer a member: hide it rather than show a dead link. The
  // id stays pinned, so it comes back if access does.
  if (isError) return null;
  const name = project?.name ?? "…";

  return (
    <div className="group relative">
      <NavTooltip label={name} enabled={collapsed}>
        <Link
          to="/projects/$projectId"
          params={{ projectId: id }}
          onClick={onNavigate}
          aria-label={collapsed ? name : undefined}
          // Long names truncate in w-56; the rail already has a tooltip.
          title={collapsed ? undefined : name}
          // The unpin button only takes room while it can be seen.
          className={cn(
            ITEM_BASE,
            collapsed
              ? "justify-center px-0"
              : "px-2.5 group-focus-within:pr-8 group-hover:pr-8",
          )}
          // Tanpa bar: menu Projects di atas ikut aktif di dalam project, dan
          // dua bar sekaligus membuat keduanya tampak sama penting.
          activeProps={{ className: "bg-surface-raised text-text font-medium" }}
          inactiveProps={{ className: "text-text hover:bg-surface-raised" }}
        >
          <span
            aria-hidden="true"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-surface-raised text-[10px] font-semibold text-text-muted ring-1 ring-border"
          >
            {project ? getInitials(project.name).charAt(0) : ""}
          </span>
          {!collapsed && <span className="min-w-0 flex-1 truncate">{name}</span>}
        </Link>
      </NavTooltip>
      {!collapsed && (
        <button
          type="button"
          onClick={() => unpin(id)}
          aria-label={`Unpin ${name}`}
          className="absolute inset-y-0 right-1 my-auto flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity [transition-duration:var(--duration-fast)] group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** "+" in the Pinned heading: search projects server-side and toggle pins.
 *  cmdk's own filter is off — the list is already the server's search result. */
function PinProjectPicker() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { isPinned, toggle } = usePinnedProjects();
  const { data, isLoading } = useProjects({
    statuses: PROJECT_STATUSES,
    search: search.trim() || undefined,
    page: 1,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pin a project"
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-raised hover:text-text"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            placeholder="Find a project…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!isLoading && <CommandEmpty>No projects found.</CommandEmpty>}
            <CommandGroup>
              {data.projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    toggle(p.id);
                    // A mouse pick moves focus off the input, and the next
                    // keystroke (Enter included) would then act on the list.
                    inputRef.current?.focus();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {isPinned(p.id) && (
                    <Check className="h-4 w-4 text-brand" aria-label="Pinned" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

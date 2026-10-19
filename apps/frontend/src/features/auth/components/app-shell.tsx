import { Fragment, useRef, useState } from "react";
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
  FileBarChart,
  Gauge,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarLayout,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "sedjiwa-ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn, getInitials } from "@/lib/utils";
import { APP_NAME } from "@/lib/app-config";
import { NotificationBell } from "@/features/notifications";
import { RunningTimerChip } from "@/features/time";
import { useAssignedOpenCount } from "@/features/dashboard";
import {
  PROJECT_STATUSES,
  useProject,
  useProjects,
  usePinnedProjects,
} from "@/features/projects";
import { SearchOverlay, searchOpenAtom } from "@/features/search";
import { currentUserAtom, isAdminAtom } from "../atoms/session";
import { sidebarCollapsedAtom } from "../atoms/sidebar";
import { useLogout } from "../api/hooks";

type NavItem = { to: string; label: string; icon: LucideIcon };

const MAIN_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-tasks", label: "My tasks", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/workload", label: "Workload", icon: Gauge },
  { to: "/reports", label: "Reports", icon: FileBarChart },
];

// Hidden rather than disabled for non-admins: a greyed-out entry would
// advertise a page they can never open. The route guards itself too, and the
// server refuses the RPCs regardless.
const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "Users", icon: ShieldCheck },
  { to: "/admin/trash", label: "Trash", icon: Trash2 },
];

// Access tokens lives in the user menu, not the nav, but still needs a
// breadcrumb label.
const SECTIONS: { to: string; label: string }[] = [
  ...MAIN_NAV,
  ...ADMIN_NAV,
  { to: "/settings/tokens", label: "Access tokens" },
];

/** Authed shell: sedjiwa-ui's ready-made `SidebarLayout` — icon-rail sidebar
 *  (a sheet below `md`), sticky header with the trigger on the left and our
 *  actions on the right, content on the raised `--surface`.
 *
 *  The layout's header has no slot on the left, so the breadcrumb opens the
 *  content instead. Pages keep their own padding; the layout's is zeroed.
 *  Collapsed is our persisted Jotai preference rather than the primitive's
 *  cookie, so it survives the same way it did before the port. */
export function AppShell() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);

  return (
    <SidebarLayout
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      sidebar={<AppSidebar />}
      contentClassName="p-0 md:px-0"
      headerActions={
        <>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground sm:w-56 sm:justify-start"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
          >
            <Search />
            <span className="hidden sm:inline">Search…</span>
            <span className="ml-auto hidden items-center gap-0.5 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </Button>
          <RunningTimerChip />
          <ThemeToggle />
          <NotificationBell />
        </>
      }
    >
      <SearchOverlay />
      <div className="px-4 pt-4 sm:px-6 print:hidden">
        <ShellBreadcrumb />
      </div>
      <Outlet />
    </SidebarLayout>
  );
}

/** True when `to` is the current route or one of its descendants. */
function useIsActive(to: string) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Closes the mobile sheet after a pick; a no-op on desktop. */
function useCloseOnNavigate() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function AppSidebar() {
  const isAdmin = useAtomValue(isAdminAtom);
  const openCount = useAssignedOpenCount();

  return (
    <Sidebar
      collapsible="icon"
      className="group-data-[side=left]:border-r-0 print:hidden"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <span
                  aria-hidden="true"
                  className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {APP_NAME.charAt(0)}
                </span>
                {/* Dua baris, bukan truncate: "Project Management" terpotong. */}
                <span className="line-clamp-2 text-sm font-semibold leading-tight">
                  {APP_NAME}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {MAIN_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  item={item}
                  badge={item.to === "/my-tasks" ? openCount : undefined}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <PinnedSection />

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavLink({
  item: { to, label, icon: Icon },
  badge,
}: {
  item: NavItem;
  badge?: number | null;
}) {
  const active = useIsActive(to);
  const close = useCloseOnNavigate();
  const count = badge ?? 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={count > 0 ? `${label} · ${count}` : label}
      >
        <Link to={to} onClick={close}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {count > 0 && (
        <SidebarMenuBadge className="text-num">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> open</span>
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

function PinnedSection() {
  const { ids } = usePinnedProjects();
  const { state, isMobile } = useSidebar();
  // Nothing to show in the rail, and the rail has no room for the picker.
  if (state === "collapsed" && !isMobile && ids.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      <PinProjectPicker />
      <SidebarGroupContent>
        {ids.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            Pin a project for one-click access.
          </p>
        ) : (
          <SidebarMenu>
            {ids.map((id) => (
              <PinnedProjectLink key={id} id={id} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function PinnedProjectLink({ id }: { id: string }) {
  const { project, isError } = useProject(id);
  const { unpin } = usePinnedProjects();
  const active = useIsActive(`/projects/${id}`);
  const close = useCloseOnNavigate();
  // Deleted, or no longer a member: hide it rather than show a dead link. The
  // id stays pinned, so it comes back if access does.
  if (isError) return null;
  const name = project?.name ?? "…";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={name}>
        <Link
          to="/projects/$projectId"
          params={{ projectId: id }}
          onClick={close}
          title={name}
        >
          <span
            aria-hidden="true"
            className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-card text-[10px] font-semibold text-muted-foreground ring-1 ring-border"
          >
            {project ? getInitials(project.name).charAt(0) : ""}
          </span>
          <span>{name}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        onClick={() => unpin(id)}
        aria-label={`Unpin ${name}`}
      >
        <X aria-hidden="true" />
      </SidebarMenuAction>
    </SidebarMenuItem>
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
        <SidebarGroupAction aria-label="Pin a project">
          <Plus aria-hidden="true" />
        </SidebarGroupAction>
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
                    <Check className="h-4 w-4 text-primary" aria-label="Pinned" />
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

function UserMenu() {
  const user = useAtomValue(currentUserAtom);
  const logout = useLogout();
  const navigate = useNavigate();
  const close = useCloseOnNavigate();
  const { state, isMobile } = useSidebar();
  const rail = state === "collapsed" && !isMobile;

  if (!user) return null;

  function onSignOut() {
    close();
    logout();
    navigate({ to: "/login" });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={rail ? `Account: ${user.displayName}` : undefined}
            >
              <Avatar size="sm">
                <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">{user.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.phone}
                </span>
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={rail ? "right" : "top"}
            align={rail ? "end" : "start"}
            className="w-[13rem]"
          >
            <DropdownMenuLabel className="flex flex-col font-normal">
              <span className="truncate font-medium text-foreground">
                {user.displayName}
              </span>
              <span className="truncate text-xs text-muted-foreground">{user.phone}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/tokens" onClick={close}>
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
      </SidebarMenuItem>
    </SidebarMenu>
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
                  <BreadcrumbPage className="truncate font-medium text-foreground">
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

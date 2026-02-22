import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { useAuth } from "react-oidc-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Settings,
  Plus,
  LogOut,
  ChevronsUpDown,
  LayoutDashboard,
} from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { ProjectForm } from "@/components/projects/project-form";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Project, ProjectCore, ProjectStatus } from "@/types/project";

const STATUS_DOT_COLORS: Record<ProjectStatus, string> = {
  pending: "bg-gray-400",
  prospect: "bg-amber-400",
  win: "bg-emerald-400",
  on_going: "bg-blue-400",
  canceled: "bg-red-400",
};

function ProjectTreeItem({ project }: { project: Project & { coreDetail: ProjectCore | null } }) {
  const params = useParams({ strict: false });
  const activeProjectId = (params as { projectId?: string }).projectId;
  const isProjectActive = activeProjectId === project.id;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isProjectActive} tooltip={project.coreDetail?.name.name}>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
        >
          <span
            className={`size-2 rounded-full shrink-0 ${STATUS_DOT_COLORS[project.status.value] ?? "bg-gray-400"}`}
          />
          <span className="truncate">{project.coreDetail?.name.name}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function UserMenu() {
  const auth = useAuth();
  const name = (auth.user?.profile?.name as string) ?? "";
  const email = (auth.user?.profile?.email as string) ?? "";
  const initials = name
    ? name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
    : "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Avatar className="size-8 border border-sidebar-border">
                <AvatarFallback className="bg-sidebar-primary/15 text-sidebar-primary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold text-sidebar-accent-foreground">
                  {name || "User"}
                </span>
                <span className="truncate text-xs text-sidebar-foreground">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            side="top"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuItem onClick={() => auth.signoutRedirect()}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { data: projects } = useProjects();
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const isDashboardActive = pathname === "/dashboard" || pathname === "/dashboard/";
  const isSettingsActive = pathname.startsWith("/settings");

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-5 py-4">
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="size-4"
            >
              <path
                d="M2 4.5A2.5 2.5 0 014.5 2h2a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4A.5.5 0 012 6.5v-2zM9 2.5a.5.5 0 01.5-.5h2A2.5 2.5 0 0114 4.5v2a.5.5 0 01-.5.5h-4a.5.5 0 01-.5-.5v-4zM2 9.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2A2.5 2.5 0 012 11.5v-2zM9.5 9a.5.5 0 00-.5.5v2A2.5 2.5 0 0011.5 14h2a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-4z"
                fill="currentColor"
                className="text-sidebar-primary-foreground"
              />
            </svg>
          </div>
          <div className="grid text-left leading-tight">
            <span className="text-sm font-bold tracking-tight text-sidebar-accent-foreground font-display">
              Tasks Manager
            </span>
            <span className="text-[10px] font-medium tracking-wider uppercase text-sidebar-foreground">
              Workspace
            </span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isDashboardActive}>
                  <Link to="/dashboard">
                    <LayoutDashboard className="size-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2">
            <SidebarGroupLabel className="text-[10px] tracking-widest uppercase text-sidebar-foreground/50 font-semibold">
              Projects
            </SidebarGroupLabel>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-sidebar-foreground/50 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
              onClick={() => setProjectFormOpen(true)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects?.map((project) => (
                <ProjectTreeItem key={project.id} project={project} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isSettingsActive}>
                  <Link to="/settings">
                    <Settings className="size-4" />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu />
      </SidebarFooter>
      <ProjectForm open={projectFormOpen} onOpenChange={setProjectFormOpen} />
    </Sidebar>
  );
}

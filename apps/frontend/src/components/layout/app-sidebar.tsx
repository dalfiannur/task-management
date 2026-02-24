import { Link, useParams, useLocation } from "react-router";
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
import { cn } from "@/lib/utils";
import type { Project, ProjectStatus } from "@/types/project";
import styles from "./app-sidebar.module.css";

const STATUS_DOT_COLORS: Record<ProjectStatus, string> = {
  pending: "dot-pending",
  prospect: "dot-prospect",
  win: "dot-win",
  won: "dot-won",
  on_going: "dot-on-going",
  canceled: "dot-canceled",
};

function ProjectTreeItem({ project }: { project: Project }) {
  const params = useParams();
  const activeProjectId = (params as { projectId?: string }).projectId;
  const isProjectActive = activeProjectId === project.id;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isProjectActive} tooltip={project.coreName}>
        <Link to={`/projects/${project.id}`}>
          <span
            className={cn(styles.statusDot, STATUS_DOT_COLORS[project.status.value] ?? "dot-pending")}
          />
          <span className={styles.projectName}>{project.coreName}</span>
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
            <SidebarMenuButton size="lg">
              <Avatar className={styles.avatarRoot}>
                <AvatarFallback className={styles.avatarFallbackEl}>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className={styles.userInfo}>
                <span className={styles.userName}>
                  {name || "User"}
                </span>
                <span className={styles.userEmail}>
                  {email}
                </span>
              </div>
              <ChevronsUpDown className={styles.chevronIcon} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className={styles.dropdownContent}
            side="top"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuItem onClick={() => auth.signoutRedirect()}>
              <LogOut className={styles.logoutIcon} />
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

  const { pathname } = useLocation();
  const isDashboardActive = pathname === "/dashboard" || pathname === "/dashboard/";
  const isSettingsActive = pathname.startsWith("/settings");

  return (
    <Sidebar>
      <SidebarHeader className={styles.headerArea}>
        <Link to="/dashboard" className={styles.logoLink}>
          <div className={styles.logoBox}>
            <svg viewBox="0 0 16 16" fill="none" className={styles.logoIcon}>
              <path
                d="M2 4.5A2.5 2.5 0 014.5 2h2a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4A.5.5 0 012 6.5v-2zM9 2.5a.5.5 0 01.5-.5h2A2.5 2.5 0 0114 4.5v2a.5.5 0 01-.5.5h-4a.5.5 0 01-.5-.5v-4zM2 9.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2A2.5 2.5 0 012 11.5v-2zM9.5 9a.5.5 0 00-.5.5v2A2.5 2.5 0 0011.5 14h2a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-4z"
                fill="currentColor"
                className={styles.logoIconPath}
              />
            </svg>
          </div>
          <div className={styles.logoText}>
            <span className={styles.logoTitle}>Tasks Manager</span>
            <span className={styles.logoSubtitle}>Workspace</span>
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
                    <LayoutDashboard className={styles.icon} />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <div className={styles.projectsHeader}>
            <SidebarGroupLabel className={styles.projectsLabel}>
              Projects
            </SidebarGroupLabel>
            <Button
              variant="ghost"
              size="icon"
              className={styles.addProjectBtn}
              onClick={() => setProjectFormOpen(true)}
            >
              <Plus className={styles.addProjectIcon} />
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
        <SidebarGroup className={styles.settingsGroup}>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isSettingsActive}>
                  <Link to="/settings">
                    <Settings className={styles.icon} />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className={styles.footerArea}>
        <UserMenu />
      </SidebarFooter>
      <ProjectForm open={projectFormOpen} onOpenChange={setProjectFormOpen} />
    </Sidebar>
  );
}

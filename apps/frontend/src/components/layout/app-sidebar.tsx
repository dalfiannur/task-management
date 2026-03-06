import { Link, useNavigate, useParams, useLocation, useSearchParams } from "react-router";
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
  ListChecks,
  CheckCircle2,
} from "lucide-react";
import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { useNewLeads } from "@/hooks/use-leads";
import { ProjectForm } from "@/components/projects/project-form";
import { ApproveLeadDialog } from "@/components/dashboard/approve-lead-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CoreProject, ProjectDisplayStatus } from "@/types/project";
import { getDisplayStatus } from "@/types/project";
import { useCompanyStore } from "@/stores/company-store";
import styles from "./app-sidebar.module.css";

const STATUS_DOT_COLORS: Record<ProjectDisplayStatus, string> = {
  draft: "dot-draft",
  pending: "dot-pending",
  proposal: "dot-proposal",
  won: "dot-won",
  active: "dot-active",
  completed: "dot-completed",
  archived: "dot-archived",
  lost: "dot-lost",
};

const MAX_SIDEBAR_ITEMS = 5;

function ProjectItem({ project }: { project: CoreProject }) {
  const params = useParams();
  const activeProjectId = (params as { projectId?: string }).projectId;
  const isActive = activeProjectId === project.id;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={getProjectDisplayName(project)}>
        <Link to={`/projects/${project.id}`}>
          <span
            className={cn(styles.statusDot, STATUS_DOT_COLORS[getDisplayStatus(project)] ?? "dot-pending")}
          />
          <span className={styles.projectName}>{getProjectDisplayName(project)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LeadItem({ project, onApprove }: { project: CoreProject; onApprove: () => void }) {
  return (
    <SidebarMenuItem>
      <div className={styles.leadItemRow}>
        <SidebarMenuButton tooltip={getProjectDisplayName(project)} className={styles.leadButton} onClick={onApprove}>
          <span className={cn(styles.statusDot, "dot-pending")} />
          <span className={styles.projectName}>{getProjectDisplayName(project)}</span>
        </SidebarMenuButton>
        <Button
          variant="ghost"
          size="icon"
          className={styles.approveBtn}
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          <CheckCircle2 className={styles.approveIcon} />
        </Button>
      </div>
    </SidebarMenuItem>
  );
}

function ShowAllButton({ to }: { to: string }) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const url = new URL(to, "http://x");
  const isActive =
    pathname === url.pathname &&
    searchParams.get("type") === url.searchParams.get("type");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} className={styles.showAllBtn}>
        <Link to={to}>
          <span className={styles.showAllText}>Show All</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function UserMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
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
            <DropdownMenuItem onSelect={() => navigate("/logout")}>
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
  const selectedCompanyId = useCompanyStore((s) => s.selectedCompanyId);
  const { data: allProjects } = useProjects(selectedCompanyId ? { ownerId: selectedCompanyId } : undefined);
  const { data: leads } = useNewLeads(selectedCompanyId ?? undefined);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [approveProject, setApproveProject] = useState<CoreProject | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);

  const { pathname } = useLocation();
  const isDashboardActive = pathname === "/dashboard" || pathname === "/dashboard/";
  const isMyTasksActive = pathname.startsWith("/my-tasks");
  const isSettingsActive = pathname.startsWith("/settings");

  const rootProjects = allProjects?.filter(
    (p) => !p.ref?.parentId,
  );
  const internalProjects = rootProjects?.filter((p) => !p.commercial);
  const commercialProjects = allProjects?.filter((p) => p.commercial && p.winStage !== "pending")

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
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isMyTasksActive}>
                  <Link to="/my-tasks">
                    <ListChecks className={styles.icon} />
                    <span>My Tasks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Internal Projects */}
        <SidebarGroup>
          <div className={styles.projectsHeader}>
            <SidebarGroupLabel className={styles.projectsLabel}>
              Internal Project
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
              {internalProjects?.slice(0, MAX_SIDEBAR_ITEMS).map((project) => (
                <ProjectItem key={project.id} project={project} />
              ))}
              {internalProjects && internalProjects.length === 0 && (
                <li className={styles.emptyHint}>No projects</li>
              )}
              <ShowAllButton to="/projects?type=internal" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* New Leads */}
        <SidebarGroup>
          <SidebarGroupLabel className={styles.projectsLabel}>
            New Leads
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {leads?.slice(0, MAX_SIDEBAR_ITEMS).map((lead) => (
                <LeadItem
                  key={lead.id}
                  project={lead}
                  onApprove={() => {
                    setApproveProject(lead);
                    setApproveDialogOpen(true);
                  }}
                />
              ))}
              {leads && leads.length === 0 && (
                <li className={styles.emptyHint}>No leads</li>
              )}
              <ShowAllButton to="/projects?type=leads" />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Commercial Projects */}
        <SidebarGroup>
          <SidebarGroupLabel className={styles.projectsLabel}>
            Commercial Project
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {commercialProjects?.slice(0, MAX_SIDEBAR_ITEMS).map((project, index) => (
                <ProjectItem key={project.id + index} project={project} />
              ))}
              {commercialProjects && commercialProjects.length === 0 && (
                <li className={styles.emptyHint}>No projects</li>
              )}
              <ShowAllButton to="/projects?type=commercial" />
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
      <ApproveLeadDialog
        project={approveProject}
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
      />
    </Sidebar>
  );
}

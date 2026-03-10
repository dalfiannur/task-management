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
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
  ChevronRight,
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

const STATUS_DOT_COLORS: Record<ProjectDisplayStatus, string> = {
  draft: "bg-gray-400",
  pending: "bg-gray-400",
  proposal: "bg-yellow-400",
  won: "bg-emerald-400",
  active: "bg-blue-400",
  completed: "bg-purple-500",
  archived: "bg-red-400",
  lost: "bg-red-400",
};

const MAX_SIDEBAR_ITEMS = 5;

function ProjectItem({ project }: { project: CoreProject }) {
  const params = useParams();
  const activeProjectId = (params as { projectId?: string }).projectId;
  const isActive = activeProjectId === project.id;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={getProjectDisplayName(project)}
        className={cn(
          "border-l-[3px] border-transparent",
          isActive && "border-sidebar-primary bg-sidebar-primary/8 text-sidebar-primary font-medium",
        )}
      >
        <Link to={`/projects/${project.id}`}>
          <span
            className={cn(
              "size-2 rounded-full shrink-0",
              STATUS_DOT_COLORS[getDisplayStatus(project)] ?? "bg-gray-400",
            )}
          />
          <span className="truncate">{getProjectDisplayName(project)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LeadItem({ project, onApprove }: { project: CoreProject; onApprove: () => void }) {
  return (
    <SidebarMenuItem>
      <div className="group/lead flex items-center w-full">
        <SidebarMenuButton
          tooltip={getProjectDisplayName(project)}
          className="flex-1 min-w-0"
          onClick={onApprove}
        >
          <span className={cn("size-2 rounded-full shrink-0", "bg-gray-400")} />
          <span className="truncate">{getProjectDisplayName(project)}</span>
        </SidebarMenuButton>
        <Button
          variant="ghost"
          size="icon"
          className="size-[1.375rem] shrink-0 text-sidebar-foreground/40 opacity-0 transition-[opacity,color] duration-150 group-hover/lead:opacity-100 hover:text-sidebar-primary hover:bg-sidebar-primary/10"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          <CheckCircle2 className="size-[0.8125rem]" />
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
      <SidebarMenuButton asChild isActive={isActive} className="opacity-60 hover:opacity-100">
        <Link to={to}>
          <span className="text-xs font-medium text-sidebar-primary/40">Show All</span>
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
              <Avatar className="size-[1.875rem] border border-sidebar-border">
                <AvatarFallback className="bg-sidebar-primary/15 text-sidebar-primary text-sm font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold text-sidebar-accent-foreground">
                  {name || "User"}
                </span>
                <span className="truncate text-sm text-sidebar-foreground">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-3.5 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
            side="top"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuItem onSelect={() => navigate("/logout")}>
              <LogOut className="mr-2 size-3.5" />
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
      <SidebarHeader className="border-b border-sidebar-primary/12 px-4 py-4">
        <Link to="/dashboard" className="flex items-center gap-2.5 transition-opacity duration-150 hover:opacity-80">
          <div className="flex size-[1.875rem] items-center justify-center rounded-[var(--radius)] bg-sidebar-primary shadow-md shadow-sidebar-primary/20">
            <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
              <path
                d="M2 4.5A2.5 2.5 0 014.5 2h2a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4A.5.5 0 012 6.5v-2zM9 2.5a.5.5 0 01.5-.5h2A2.5 2.5 0 0114 4.5v2a.5.5 0 01-.5.5h-4a.5.5 0 01-.5-.5v-4zM2 9.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2A2.5 2.5 0 012 11.5v-2zM9.5 9a.5.5 0 00-.5.5v2A2.5 2.5 0 0011.5 14h2a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-4z"
                fill="currentColor"
                className="text-sidebar-primary-foreground"
              />
            </svg>
          </div>
          <div className="grid text-left leading-tight">
            <span className="text-sm font-bold -tracking-wide text-sidebar-accent-foreground font-[family-name:var(--font-sans)]">Tasks Manager</span>
            <span className="text-[13px] font-medium tracking-widest uppercase text-sidebar-foreground font-[family-name:var(--font-mono)]">Workspace</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isDashboardActive}
                  className={cn(
                    "border-l-[3px] border-transparent",
                    isDashboardActive && "border-sidebar-primary bg-sidebar-primary/8 text-sidebar-primary",
                  )}
                >
                  <Link to="/dashboard">
                    <LayoutDashboard className="size-3.5" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isMyTasksActive}
                  className={cn(
                    "border-l-[3px] border-transparent",
                    isMyTasksActive && "border-sidebar-primary bg-sidebar-primary/8 text-sidebar-primary",
                  )}
                >
                  <Link to="/my-tasks">
                    <ListChecks className="size-3.5" />
                    <span>My Tasks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Internal Projects */}
        <SidebarGroup>
          <Collapsible defaultOpen className="group/collapsible">
            <div className="flex items-center justify-between pr-2">
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="flex items-center gap-1.5 cursor-pointer text-sm tracking-widest uppercase text-sidebar-primary/55 font-semibold font-[family-name:var(--font-mono)] hover:text-sidebar-primary transition-colors">
                  Internal Project
                  <ChevronRight className="size-3 text-sidebar-primary/40 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="size-[1.375rem] text-sidebar-foreground/50 hover:text-sidebar-primary hover:bg-sidebar-primary/10"
                onClick={() => setProjectFormOpen(true)}
              >
                <Plus className="size-[0.8125rem]" />
              </Button>
            </div>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {internalProjects?.slice(0, MAX_SIDEBAR_ITEMS).map((project) => (
                    <ProjectItem key={project.id} project={project} />
                  ))}
                  {internalProjects && internalProjects.length === 0 && (
                    <li className="px-2 pl-8 py-1 text-xs text-sidebar-foreground/40">No projects</li>
                  )}
                  <ShowAllButton to="/projects?type=internal" />
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        {/* New Leads */}
        <SidebarGroup>
          <Collapsible defaultOpen className="group/collapsible">
            <div className="flex items-center justify-between pr-2">
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="flex items-center gap-1.5 cursor-pointer text-sm tracking-widest uppercase text-sidebar-primary/55 font-semibold font-[family-name:var(--font-mono)] hover:text-sidebar-primary transition-colors">
                  New Leads
                  <ChevronRight className="size-3 text-sidebar-primary/40 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
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
                    <li className="px-2 pl-8 py-1 text-xs text-sidebar-foreground/40">No leads</li>
                  )}
                  <ShowAllButton to="/projects?type=leads" />
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        {/* Commercial Projects */}
        <SidebarGroup>
          <Collapsible defaultOpen className="group/collapsible">
            <div className="flex items-center justify-between pr-2">
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="flex items-center gap-1.5 cursor-pointer text-sm tracking-widest uppercase text-sidebar-primary/55 font-semibold font-[family-name:var(--font-mono)] hover:text-sidebar-primary transition-colors">
                  Commercial Project
                  <ChevronRight className="size-3 text-sidebar-primary/40 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {commercialProjects?.slice(0, MAX_SIDEBAR_ITEMS).map((project, index) => (
                    <ProjectItem key={project.id + index} project={project} />
                  ))}
                  {commercialProjects && commercialProjects.length === 0 && (
                    <li className="px-2 pl-8 py-1 text-xs text-sidebar-foreground/40">No projects</li>
                  )}
                  <ShowAllButton to="/projects?type=commercial" />
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isSettingsActive}
                  className={cn(
                    "border-l-[3px] border-transparent",
                    isSettingsActive && "border-sidebar-primary bg-sidebar-primary/8 text-sidebar-primary",
                  )}
                >
                  <Link to="/settings">
                    <Settings className="size-3.5" />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-primary/15 py-3.5 px-4">
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

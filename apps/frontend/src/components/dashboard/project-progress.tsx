import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CoreProject } from "@/types/project";
import type { ProjectProgressData } from "@/hooks/use-dashboard";
import { ArrowUpDown, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectProgressProps {
  projects: CoreProject[];
  progressData: ProjectProgressData[];
}

interface ProjectStat {
  project: CoreProject;
  done: number;
  total: number;
  percentage: number;
}

type SortMode = "progress-asc" | "progress-desc" | "name-asc";

function sortStats(stats: ProjectStat[], mode: SortMode): ProjectStat[] {
  return [...stats].sort((a, b) => {
    switch (mode) {
      case "progress-asc":
        return a.percentage - b.percentage;
      case "progress-desc":
        return b.percentage - a.percentage;
      case "name-asc":
        return (a.project.name?.name ?? "").localeCompare(
          b.project.name?.name ?? ""
        );
    }
  });
}

export function ProjectProgress({ projects, progressData }: ProjectProgressProps) {
  const navigate = useNavigate();
  const [sortMode, setSortMode] = useState<SortMode>("progress-asc");

  // Build progress lookup by coreProjectId
  const progressMap = new Map<string, ProjectProgressData>();
  for (const p of progressData) {
    progressMap.set(p.coreProjectId, p);
  }

  // Build stats for active projects only
  const activeProjects = projects.filter((p) => p.status === "active");
  const allStats: ProjectStat[] = activeProjects.map((project) => {
    const progress = progressMap.get(project.id);
    const done = progress?.done ?? 0;
    const total = progress?.total ?? 0;
    return {
      project,
      done,
      total,
      percentage: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });

  // Separate root projects and sub-projects
  const rootStats = allStats.filter((s) => !s.project.ref?.parentId);
  const childrenByParent = new Map<string, ProjectStat[]>();
  for (const s of allStats) {
    const parentId = s.project.ref?.parentId;
    if (parentId) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(s);
      childrenByParent.set(parentId, children);
    }
  }

  // Sort root projects and sub-projects within each group
  const sortedRoots = sortStats(rootStats, sortMode);
  for (const [parentId, children] of childrenByParent) {
    childrenByParent.set(parentId, sortStats(children, sortMode));
  }

  // Build flat render list: parent followed by its children
  const renderList: { stat: ProjectStat; isChild: boolean }[] = [];
  for (const stat of sortedRoots) {
    renderList.push({ stat, isChild: false });
    const children = childrenByParent.get(stat.project.id);
    if (children) {
      for (const child of children) {
        renderList.push({ stat: child, isChild: true });
      }
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between [&>*+*]:mt-0">
        <CardTitle className="text-[0.9375rem] leading-[1.375rem] font-semibold">Project Progress</CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={(v) => setSortMode(v as SortMode)}
            >
              <DropdownMenuRadioItem value="progress-asc">
                Lowest progress first
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="progress-desc">
                Highest progress first
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name-asc">
                Alphabetical
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {renderList.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <BarChart3 className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No active projects</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {renderList.map(({ stat: { project, done, total, percentage }, isChild }) => (
              <div
                key={project.id}
                className={cn(
                  "flex flex-col gap-1.5 cursor-pointer rounded-md p-1.5 px-2 -m-1.5 -mx-2 transition-colors hover:bg-muted",
                  isChild && "pl-6 ml-0"
                )}
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[0.6875rem] leading-4 font-mono shrink-0">
                    {project.code ?? project.id.slice(0, 6)}
                  </Badge>
                  <span className="flex-1 text-sm font-medium truncate">
                    {project.name?.name ?? "Untitled"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground font-mono">
                    {done}/{total} done
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

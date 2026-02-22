import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproveLeadDialog } from "./approve-lead-dialog";
import type { Project, ProjectCore } from "@/types/project";
import { useUsers } from "@/hooks/use-users";
import { Sparkles } from "lucide-react";

type ProjectWithCore = Project & { coreDetail: ProjectCore | null };

interface NewLeadsProps {
  projects: ProjectWithCore[];
}

export function NewLeads({ projects }: NewLeadsProps) {
  const [selectedProject, setSelectedProject] = useState<ProjectWithCore | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: users } = useUsers();

  function getPicName(picId?: string) {
    if (!picId || !users) return null;
    const user = users.find((u) => u.id === picId);
    return user?.name ?? null;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">New Leads</CardTitle>
          {projects.length > 0 && (
            <Badge
              variant="secondary"
              className="text-xs font-display font-semibold"
            >
              {projects.length} pending
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              <Sparkles className="size-5" />
              <p className="text-sm">No new leads at the moment.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => {
                const picName = getPicName(project.picId?.value);
                return (
                  <div
                    key={project.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-accent/50"
                  >
                    <div className="w-1 self-stretch rounded-full bg-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="shrink-0 font-mono text-[10px]"
                        >
                          {project.coreDetail?.code ?? project.id}
                        </Badge>
                        <span className="text-sm font-medium truncate">
                          {project.coreDetail?.name.name ?? "Untitled"}
                        </span>
                      </div>
                      {picName && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {picName}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        setSelectedProject(project);
                        setDialogOpen(true);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ApproveLeadDialog
        project={selectedProject}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

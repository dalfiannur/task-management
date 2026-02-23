import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproveLeadDialog } from "./approve-lead-dialog";
import type { Project, ProjectCore } from "@/types/project";
import { useUsers } from "@/hooks/use-users";
import { Sparkles } from "lucide-react";
import styles from "./new-leads.module.css";

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
        <CardHeader className={styles.headerRow}>
          <CardTitle className={styles.cardTitle}>New Leads</CardTitle>
          {projects.length > 0 && (
            <Badge
              variant="secondary"
              className={styles.pendingBadge}
            >
              {projects.length} pending
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className={styles.emptyState}>
              <Sparkles className={styles.emptyIcon} />
              <p className={styles.emptyText}>No new leads at the moment.</p>
            </div>
          ) : (
            <div className={styles.leadsList}>
              {projects.map((project) => {
                const picName = getPicName(project.picId?.value);
                return (
                  <div
                    key={project.id}
                    className={styles.leadItem}
                  >
                    <div className={styles.leadStripe} />
                    <div className={styles.leadContent}>
                      <div className={styles.leadHeader}>
                        <Badge
                          variant="outline"
                          className={styles.codeBadge}
                        >
                          {project.coreDetail?.code ?? project.id}
                        </Badge>
                        <span className={styles.leadName}>
                          {project.coreDetail?.name.name ?? "Untitled"}
                        </span>
                      </div>
                      {picName && (
                        <p className={styles.picName}>
                          {picName}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className={styles.approveBtn}
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

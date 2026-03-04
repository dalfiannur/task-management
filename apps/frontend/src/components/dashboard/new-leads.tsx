import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproveLeadDialog } from "./approve-lead-dialog";
import type { Project } from "@/types/project";
import { useUser } from "@/hooks/use-users";
import { Sparkles } from "lucide-react";
import styles from "./new-leads.module.css";

interface NewLeadsProps {
  projects: Project[];
}

function LeaderName({ leaderId }: { leaderId?: string }) {
  const { data: user } = useUser(leaderId);
  if (!leaderId || !user?.name) return null;
  return <p className={styles.picName}>{user.name}</p>;
}

export function NewLeads({ projects }: NewLeadsProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
              {projects.map((project) => (
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
                        {project.code ?? project.id}
                      </Badge>
                      <span className={styles.leadName}>
                        {project.coreName ?? "Untitled"}
                      </span>
                    </div>
                    <LeaderName leaderId={project.projectLeaderId?.value} />
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
              ))}
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

import { createFileRoute } from "@tanstack/react-router";
import { useProjects, getProjectDisplayName } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectForm } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/projects/")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const { data: allProjects, isLoading } = useProjects();
  const projects = allProjects?.filter((p) => p.status.value !== "pending");
  const nameMap = new Map(
    projects?.map((p) => [p.id, getProjectDisplayName(p)]),
  );
  const [formOpen, setFormOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="size-4 mr-1" />
          New Project
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            parentName={
              project.parent
                ? nameMap.get(project.parent.id)
                : undefined
            }
          />
        ))}
      </div>
      {projects?.length === 0 && (
        <p className="text-center text-muted-foreground py-12">
          No projects yet. Create one to get started.
        </p>
      )}
      <ProjectForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}

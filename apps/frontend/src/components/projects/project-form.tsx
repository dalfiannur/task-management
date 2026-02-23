import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { UserCombobox } from "@/components/shared/user-combobox";
// TODO: createProject and updateProject mutations are not available yet on backend
// import { useCreateProject, useUpdateProject } from "@/hooks/use-projects";
import type { Project, ProjectCore, ProjectStatus } from "@/types/project";
import { PROJECT_STATUS_CONFIG } from "@/types/project";
import styles from "./project-form.module.css";

interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project & { coreDetail: ProjectCore | null };
}

export function ProjectForm({ open, onOpenChange, project }: ProjectFormProps) {
  const isEditing = !!project;

  const [title, setTitle] = useState(project?.coreDetail?.name.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [picId, setPicId] = useState<string | undefined>(project?.picId?.value);
  const [status, setStatus] = useState<ProjectStatus>(
    project?.status.value ?? "pending",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: createProject/updateProject mutations not available yet
    console.warn("Project create/update not yet supported");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Edit Project" : "Create Project"}
            </DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <Label htmlFor="project-title">Title</Label>
              <Input
                id="project-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title..."
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <Label>Description</Label>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Describe the project..."
              />
            </div>
            <div className={styles.field}>
              <Label>Person In Contact</Label>
              <UserCombobox value={picId} onChange={setPicId} />
            </div>
            <div className={styles.field}>
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as ProjectStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(PROJECT_STATUS_CONFIG) as [
                      ProjectStatus,
                      { label: string },
                    ][]
                  )
                    .filter(([value]) => value !== "win")
                    .map(([value, config]) => (
                      <SelectItem key={value} value={value}>
                        {config.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {isEditing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

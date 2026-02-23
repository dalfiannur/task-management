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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { UserCombobox } from "@/components/shared/user-combobox";
import { useCreateSubProject } from "@/hooks/use-projects";
import styles from "./sub-project-form.module.css";

interface SubProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentProjectId: string;
}

export function SubProjectForm({
  open,
  onOpenChange,
  parentProjectId,
}: SubProjectFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picId, setPicId] = useState<string | undefined>();
  const createSubProject = useCreateSubProject();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSubProject.mutate(
      {
        parentProjectId,
        name: name.trim(),
        description: description || undefined,
        picId,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          setPicId(undefined);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Sub-Project</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <Label htmlFor="sub-project-name">Name</Label>
              <Input
                id="sub-project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sub-project name..."
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <Label>Description</Label>
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Describe the sub-project..."
              />
            </div>
            <div className={styles.field}>
              <Label>Project Manager</Label>
              <UserCombobox value={picId} onChange={setPicId} />
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
            <Button
              type="submit"
              disabled={!name.trim() || createSubProject.isLoading}
            >
              {createSubProject.isLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

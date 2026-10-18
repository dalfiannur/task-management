import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "sedjiwa-ui";
import { useSaveTaskTemplate } from "../api/templates";

/** Name a snapshot of `task` (and its subtasks' titles) as a task template. */
export function SaveTemplateDialog({
  task,
  open,
  onOpenChange,
}: {
  task: { id: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveTaskTemplate();
  const [name, setName] = useState(task.title);
  const [lastOpen, setLastOpen] = useState(open);
  // Re-seed each time it opens.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setName(task.title);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { taskId: task.id, name: name.trim() },
      {
        onSuccess: (t) => {
          toast.success(`Template "${t.name}" saved.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message || "Failed to save template"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save task as template</DialogTitle>
          <DialogDescription>
            Keeps the title, description, priority, estimate, labels and subtask
            titles for reuse in this project.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input.Root>
              <Input.Field
                id="template-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Input.Root>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

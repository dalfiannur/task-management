import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label, Textarea, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "sedjiwa-ui";
import type { Module } from "../types";
import { useCreateModule, useUpdateModule } from "../api/hooks";

export function ModuleDialog({
  open,
  onOpenChange,
  projectId,
  module,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  /** Edit mode when provided. */
  module?: Module;
}) {
  const create = useCreateModule();
  const update = useUpdateModule();
  const editing = !!module;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(module?.name ?? "");
    setDescription(module?.description ?? "");
  }, [open, module]);

  const pending = create.isPending || update.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const onError = (err: { message: string }) =>
      toast.error(err.message || "Failed to save module");
    if (editing) {
      update.mutate(
        { id: module.id, name: name.trim(), description },
        { onSuccess: () => onOpenChange(false), onError },
      );
    } else {
      create.mutate(
        { projectId, name: name.trim(), description: description || undefined },
        { onSuccess: () => onOpenChange(false), onError },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit module" : "New module"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mod-name">Name</Label>
            <Input.Root>
              <Input.Field
                id="mod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </Input.Root>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mod-desc">Description</Label>
            <Textarea
              id="mod-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LABEL_COLORS, type Label } from "../types";
import { useLabels, useCreateLabel, useUpdateLabel, useDeleteLabel } from "../api/hooks";

function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{ backgroundColor: c }}
          className={cn(
            "h-6 w-6 rounded-full ring-offset-2 transition-all",
            value === c && "ring-2 ring-text",
          )}
          aria-label={`Color ${c}`}
        />
      ))}
    </div>
  );
}

function LabelRow({ label }: { label: Label }) {
  const update = useUpdateLabel();
  const del = useDeleteLabel();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);

  function save() {
    if (!name.trim()) return;
    update.mutate(
      { id: label.id, name: name.trim(), color },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => toast.error(e.message || "Update failed"),
      },
    );
  }

  if (editing) {
    return (
      <li className="space-y-2 rounded-lg bg-surface-sunken p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <ColorSwatches value={color} onChange={setColor} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover">
      <span
        className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: `${label.color}22`, color: label.color }}
      >
        {label.name}
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100"
        onClick={() => setEditing(true)}
        aria-label="Edit label"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100"
        onClick={() =>
          del.mutate(
            { id: label.id },
            { onError: (e) => toast.error(e.message || "Delete failed") },
          )
        }
        aria-label="Delete label"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/** Palette manager: list/create/edit/delete project labels. */
export function ManageLabelsDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { labels } = useLabels(projectId);
  const create = useCreateLabel();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  function add() {
    if (!name.trim()) return;
    create.mutate(
      { projectId, name: name.trim(), color },
      {
        onSuccess: () => {
          setName("");
          setColor(LABEL_COLORS[0]);
        },
        onError: (e) => toast.error(e.message || "Create failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage labels</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 rounded-lg bg-surface-sunken p-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New label name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button size="icon" onClick={add} disabled={create.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ColorSwatches value={color} onChange={setColor} />
        </div>

        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {labels.length === 0 ? (
            <li className="p-3 text-center text-sm text-text-muted">
              No labels yet.
            </li>
          ) : (
            labels.map((l) => <LabelRow key={l.id} label={l} />)
          )}
        </ul>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

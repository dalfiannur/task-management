import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useCreateModule, useUpdateModule, useModules } from "@/hooks/use-modules";
import { MODULE_COLORS } from "./module-section";
import type { Module } from "@/types/task";

interface ModuleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  module?: Module;
}

export function ModuleForm({
  open,
  onOpenChange,
  projectId,
  module,
}: ModuleFormProps) {
  const isEditing = !!module;
  const createModule = useCreateModule();
  const updateModule = useUpdateModule();
  const { data: existingModules } = useModules(projectId);

  const [name, setName] = useState(module?.name ?? "");
  const [description, setDescription] = useState(module?.description ?? "");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName(module?.name ?? "");
      setDescription(module?.description ?? "");
    }
  }, [open, module]);

  // Determine the color this module will get
  const colorIndex = isEditing
    ? (existingModules?.findIndex((m) => m.id === module.id) ?? 0)
    : (existingModules?.length ?? 0);
  const accentColor = MODULE_COLORS[colorIndex % MODULE_COLORS.length];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (isEditing) {
      updateModule.mutate(
        { id: module.id, input: { name, description } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createModule.mutate(
        { name, description, projectId },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && name.trim()) {
        e.preventDefault();
        const form = document.querySelector<HTMLFormElement>(
          "[data-module-form]",
        );
        form?.requestSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        {/* Color accent strip */}
        <div
          className="h-1 w-full"
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }}
        />

        <form onSubmit={handleSubmit} data-module-form>
          <div className="p-6 pb-0">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                {isEditing ? "Edit Module" : "New Module"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {isEditing
                  ? "Edit module details"
                  : "Fill in the details to create a new module"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* Title input with accent bar */}
              <div className="flex gap-3">
                <div
                  className="w-1 shrink-0 rounded-full self-stretch transition-colors"
                  style={{ backgroundColor: accentColor }}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Module name..."
                  className="flex-1 text-xl font-bold font-display tracking-tight bg-transparent border-0 outline-none placeholder:font-normal placeholder:text-base placeholder:text-muted-foreground/40"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Description
                </p>
                <RichTextEditor
                  content={description}
                  onChange={setDescription}
                  placeholder="Describe what this module covers..."
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 mt-2 border-t">
            <span className="text-[11px] text-muted-foreground/50">
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                ⌘
              </kbd>{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                ↵
              </kbd>{" "}
              to submit
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!name.trim()}
              >
                {isEditing ? "Save Changes" : "Create Module"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { useFormShortcut } from "@/hooks/use-form-shortcut";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { UserCombobox } from "@/components/shared/user-combobox";
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
  const [picId, setPicId] = useState<string | undefined>(module?.picId);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName(module?.name ?? "");
      setDescription(module?.description ?? "");
      setPicId(module?.picId);
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
        { id: module.id, input: { name, description, picId } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createModule.mutate(
        { name, description, projectId, picId },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  useFormShortcut(open, "[data-module-form]", !!name.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem] p-0 overflow-hidden">
        {/* Color accent strip */}
        <div
          className="h-1 w-full"
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }}
        />

        <form onSubmit={handleSubmit} data-module-form>
          <div className="p-5 pb-0">
            <DialogHeader className="mb-4">
              <DialogTitle className="font-mono text-sm leading-4 font-semibold uppercase tracking-widest text-muted-foreground">
                {isEditing ? "Edit Module" : "New Module"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {isEditing
                  ? "Edit module details"
                  : "Fill in the details to create a new module"}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              {/* Title input with accent bar */}
              <div className="flex gap-2.5">
                <div
                  className="w-1 shrink-0 rounded-full self-stretch transition-all duration-300"
                  style={{ backgroundColor: accentColor }}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Module name..."
                  className="flex-1 text-lg leading-6 font-bold tracking-tight bg-transparent border-0 outline-none text-foreground placeholder:font-normal placeholder:text-[0.9375rem] placeholder:leading-[1.375rem] placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <p className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Description
                </p>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this module covers..."
                  maxLength={500}
                  className="resize-y min-h-16 max-h-40 text-sm leading-[1.375rem]"
                  rows={3}
                />
                <span className="font-mono text-sm text-muted-foreground text-right">
                  {description.length}/500
                </span>
              </div>

              {/* Person In Charge */}
              <div className="flex flex-col gap-1.5">
                <p className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Person In Charge
                </p>
                <UserCombobox value={picId} onChange={setPicId} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between py-3.5 px-5 mt-1.5 border-t border-border">
            <span className="font-mono text-sm text-muted-foreground">
              <kbd className="py-px px-[0.3125rem] rounded-xl bg-accent text-sm font-mono">
                ⌘
              </kbd>{" "}
              <kbd className="py-px px-[0.3125rem] rounded-xl bg-accent text-sm font-mono">
                ↵
              </kbd>{" "}
              to submit
            </span>
            <div className="flex items-center gap-1.5">
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

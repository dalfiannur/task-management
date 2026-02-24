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
import styles from "./module-form.module.css";

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
      <DialogContent className={styles.dialogContent}>
        {/* Color accent strip */}
        <div
          className={styles.accentStrip}
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }}
        />

        <form onSubmit={handleSubmit} data-module-form>
          <div className={styles.formBody}>
            <DialogHeader className={styles.header}>
              <DialogTitle className={styles.headerTitle}>
                {isEditing ? "Edit Module" : "New Module"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {isEditing
                  ? "Edit module details"
                  : "Fill in the details to create a new module"}
              </DialogDescription>
            </DialogHeader>

            <div className={styles.fields}>
              {/* Title input with accent bar */}
              <div className={styles.titleRow}>
                <div
                  className={styles.accentBar}
                  style={{ backgroundColor: accentColor }}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Module name..."
                  className={styles.titleInput}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className={styles.descriptionField}>
                <p className={styles.descriptionLabel}>
                  Description
                </p>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this module covers..."
                  maxLength={500}
                  className={styles.descriptionTextarea}
                  rows={3}
                />
                <span className={styles.charCount}>
                  {description.length}/500
                </span>
              </div>

              {/* Person In Charge */}
              <div className={styles.descriptionField}>
                <p className={styles.descriptionLabel}>
                  Person In Charge
                </p>
                <UserCombobox value={picId} onChange={setPicId} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <span className={styles.shortcutHint}>
              <kbd className={styles.kbd}>
                ⌘
              </kbd>{" "}
              <kbd className={styles.kbd}>
                ↵
              </kbd>{" "}
              to submit
            </span>
            <div className={styles.footerActions}>
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

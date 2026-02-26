import { useState } from "react";
import { format } from "date-fns";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserCombobox } from "@/components/shared/user-combobox";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { useCreateSubProject } from "@/hooks/use-projects";
import { useModules } from "@/hooks/use-modules";
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
  const [projectLeaderId, setProjectLeaderId] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [moduleId, setModuleId] = useState<string | undefined>();
  const createSubProject = useCreateSubProject();
  const { data: parentModules } = useModules(parentProjectId);

  const resetForm = () => {
    setName("");
    setDescription("");
    setProjectLeaderId(undefined);
    setStartDate(undefined);
    setEndDate(undefined);
    setModuleId(undefined);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSubProject.mutate(
      {
        parentProjectId,
        name: name.trim(),
        description: description || undefined,
        projectLeaderId,
        startDate: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
        endDate: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
        moduleId,
      },
      {
        onSuccess: () => {
          resetForm();
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
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the sub-project..."
              />
            </div>
            <div className={styles.field}>
              <Label>Project Leader</Label>
              <UserCombobox value={projectLeaderId} onChange={setProjectLeaderId} />
            </div>
            {parentModules && parentModules.length > 0 && (
              <div className={styles.field}>
                <Label>Linked Module</Label>
                <Select
                  value={moduleId ?? "__none__"}
                  onValueChange={(v) => setModuleId(v === "__none__" ? undefined : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select module..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {parentModules.map((mod) => (
                      <SelectItem key={mod.id} value={mod.id}>
                        {mod.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={styles.row}>
              <div className={styles.field}>
                <Label>Start Date</Label>
                <DatePickerField value={startDate} onChange={setStartDate} />
              </div>
              <div className={styles.field}>
                <Label>End Date</Label>
                <DatePickerField value={endDate} onChange={setEndDate} />
              </div>
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

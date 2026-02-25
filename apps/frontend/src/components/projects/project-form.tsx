import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { UserCombobox } from "@/components/shared/user-combobox";
import { CompanyCombobox } from "@/components/shared/company-combobox";
import { DivisionCombobox } from "@/components/shared/division-combobox";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { useCreateProject } from "@/hooks/use-projects";
import styles from "./project-form.module.css";

interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectForm({ open, onOpenChange }: ProjectFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState<string | undefined>();
  const [projectLeaderId, setProjectLeaderId] = useState<string | undefined>();
  const [ownerId, setOwnerId] = useState<string | undefined>();
  const [divisionId, setDivisionId] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [value, setValue] = useState<string>("");
  const [commercial, setCommercial] = useState(false);
  const createProject = useCreateProject();

  // Reset divisionId when ownerId changes
  useEffect(() => {
    setDivisionId(undefined);
  }, [ownerId]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setClientId(undefined);
    setProjectLeaderId(undefined);
    setOwnerId(undefined);
    setDivisionId(undefined);
    setStartDate(undefined);
    setEndDate(undefined);
    setValue("");
    setCommercial(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    const parsedValue = value ? parseFloat(value) : undefined;
    createProject.mutate(
      {
        name: name.trim(),
        clientId,
        description: description || undefined,
        projectLeaderId,
        ownerId,
        divisionId,
        commercial: commercial || undefined,
        value: parsedValue,
        startDate: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
        endDate: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
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
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <div className={styles.fieldGroup}>
            <div className={styles.field}>
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name..."
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project..."
              />
            </div>
            <div className={styles.field}>
              <Label>Client</Label>
              <CompanyCombobox value={clientId} onChange={setClientId} />
            </div>
            <div className={styles.field}>
              <Label>Project Leader</Label>
              <UserCombobox value={projectLeaderId} onChange={setProjectLeaderId} />
            </div>
            <div className={styles.field}>
              <Label>Owner (Company)</Label>
              <CompanyCombobox value={ownerId} onChange={setOwnerId} />
            </div>
            <div className={styles.field}>
              <Label>Division</Label>
              <DivisionCombobox
                value={divisionId}
                onChange={setDivisionId}
                companyId={ownerId}
              />
            </div>
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
            <div className={styles.field}>
              <Label htmlFor="project-value">Value</Label>
              <Input
                id="project-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Project value..."
                min={0}
                step="any"
              />
            </div>
            <div className={styles.checkboxField}>
              <Checkbox
                id="project-commercial"
                checked={commercial}
                onCheckedChange={(checked) => setCommercial(checked === true)}
              />
              <Label htmlFor="project-commercial">Commercial</Label>
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
              disabled={!name.trim() || !clientId || createProject.isLoading}
            >
              {createProject.isLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

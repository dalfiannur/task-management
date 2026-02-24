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
  const [projectLeaderId, setProjectLeaderId] = useState<string | undefined>();
  const [ownerId, setOwnerId] = useState<string | undefined>();
  const [divisionId, setDivisionId] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [value, setValue] = useState<string>("");
  const [commercial, setCommercial] = useState(false);
  const createSubProject = useCreateSubProject();

  // Reset divisionId when ownerId changes
  useEffect(() => {
    setDivisionId(undefined);
  }, [ownerId]);

  const resetForm = () => {
    setName("");
    setDescription("");
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
    const parsedValue = value ? parseFloat(value) : undefined;
    createSubProject.mutate(
      {
        parentProjectId,
        name: name.trim(),
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
              <Label htmlFor="sub-project-value">Value</Label>
              <Input
                id="sub-project-value"
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
                id="sub-project-commercial"
                checked={commercial}
                onCheckedChange={(checked) => setCommercial(checked === true)}
              />
              <Label htmlFor="sub-project-commercial">Commercial</Label>
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

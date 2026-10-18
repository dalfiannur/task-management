import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button, Combobox } from "sedjiwa-ui";
import { useLabels } from "../api/hooks";
import { ManageLabelsDialog } from "./manage-labels-dialog";

/** Multi-select of project labels for the task dialog. */
export function LabelCombobox({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { labels } = useLabels(projectId);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Combobox
          multiple
          size="sm"
          options={labels}
          getOptionValue={(l) => l.id}
          getOptionLabel={(l) => l.name}
          renderOption={(l) => (
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              <span className="truncate">{l.name}</span>
            </span>
          )}
          value={value}
          onValueChange={onChange}
          placeholder="Labels"
          searchPlaceholder="Search labels…"
          emptyMessage="No labels yet."
          className="min-w-40"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Manage labels"
          onClick={() => setManageOpen(true)}
        >
          <Settings2 />
        </Button>
      </span>
      <ManageLabelsDialog
        projectId={projectId}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
    </>
  );
}

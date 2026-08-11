import { useState } from "react";
import { Check, Settings2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="justify-start">
            <Tag className="mr-1 h-4 w-4" />
            {value.length ? `${value.length} label(s)` : "Labels"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1" align="start">
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {labels.length === 0 ? (
              <li className="p-2 text-sm text-text-muted">
                No labels yet.
              </li>
            ) : (
              labels.map((l) => {
                const selected = value.includes(l.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => toggle(l.id)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-sunken"
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: l.color }}
                      />
                      <span className="flex-1 truncate text-left">{l.name}</span>
                      <Check
                        className={cn(
                          "h-4 w-4",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t pt-1">
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text-muted hover:bg-surface-sunken"
            >
              <Settings2 className="h-4 w-4" />
              Manage labels
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ManageLabelsDialog
        projectId={projectId}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
    </>
  );
}

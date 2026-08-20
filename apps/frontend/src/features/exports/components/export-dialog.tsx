import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/download";
import { useExportTasksCsv } from "../api/hooks";

export function ExportDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const csv = useExportTasksCsv();

  function onCsv() {
    csv.mutate(
      { projectId },
      {
        onSuccess: (res) => {
          downloadCsv(res.fileName, res.csv);
          const count = res.taskCount;
          toast.success(
            count === 0
              ? "Nothing to export — the file only has column headers."
              : `${count} ${count === 1 ? "task" : "tasks"} exported.`,
          );
        },
        onError: (err) => toast.error(err.message || "Export failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export project</DialogTitle>
          <DialogDescription>
            Take this project&apos;s work out of the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle p-3">
            <div>
              <p className="text-sm font-medium">Task list (.csv)</p>
              <p className="text-sm text-text-muted">
                Every task with its module, people, labels and dates. Opens in a
                spreadsheet.
              </p>
            </div>
            <Button size="sm" onClick={onCsv} disabled={csv.isPending}>
              <Download className="mr-1 h-4 w-4" />
              {csv.isPending ? "Preparing…" : "Download"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

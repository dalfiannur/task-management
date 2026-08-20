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
import { useExportTasksCsv, downloadText } from "../api/hooks";

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
        onSuccess: (res) =>
          downloadText(res.fileName, res.csv, "text/csv;charset=utf-8"),
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
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
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

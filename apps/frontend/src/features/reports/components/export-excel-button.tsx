import { useAtomValue } from "jotai";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { currentUserAtom } from "@/features/auth";
import { exportReportExcel } from "../lib/export-excel";
import type { PeriodReport, PeriodWindow } from "../types";

export function ExportExcelButton({
  report,
  window,
}: {
  report: PeriodReport | null;
  window: PeriodWindow;
}) {
  const user = useAtomValue(currentUserAtom);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    if (!report) return;
    setBusy(true);
    try {
      await exportReportExcel(report, window, user?.displayName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={!report || busy}>
      {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Export Excel
    </Button>
  );
}

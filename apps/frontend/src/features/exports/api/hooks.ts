// Export RPC hooks (connect-query over ExportService). Owner/admin only —
// the server enforces; the UI simply does not offer it to anyone else.

import { useMutation } from "@connectrpc/connect-query";
import { ExportService } from "@/lib/gen/export_pb";

/** Ask the server for a task CSV. The caller triggers the download. */
export function useExportTasksCsv() {
  return useMutation(ExportService.method.exportTasksCsv);
}

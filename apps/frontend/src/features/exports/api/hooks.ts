// Export RPC hooks (connect-query over ExportService). Owner/admin only —
// the server enforces; the UI simply does not offer it to anyone else.

import { useMutation } from "@connectrpc/connect-query";
import { ExportService } from "@/lib/gen/export_pb";

/** Ask the server for a task CSV. The caller triggers the download. */
export function useExportTasksCsv() {
  return useMutation(ExportService.method.exportTasksCsv);
}

/** Hand a generated string to the browser as a file download. */
export function downloadText(fileName: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Client-side file downloads. The only createObjectURL usage in the app —
// keep it here so any encoding decision (see the BOM below) lives in one
// place instead of leaking into feature components.

const UTF8_BOM = "﻿";

/**
 * Hand CSV text to the browser as a file download.
 *
 * Prefixes the content with a UTF-8 BOM: Excel on Windows — the most likely
 * destination for a file this app's UI promises "opens in a spreadsheet" —
 * renders UTF-8 as mojibake without it, and task/project titles here are
 * free text that will contain non-ASCII (Indonesian) sooner rather than
 * later. The trade-off is deliberate: a strict parser reading the file as
 * plain UTF-8 will see a stray character at the start (Python's `csv` needs
 * `encoding="utf-8-sig"` to skip it), but that's a smaller cost than mojibake
 * in the destination the UI actually advertises.
 */
export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([UTF8_BOM + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

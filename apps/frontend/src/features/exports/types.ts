// Flat FE types for the exports feature. Phase 1 only needs the CSV shape;
// job types arrive with the archive path.

export type CsvExport = {
  csv: string;
  fileName: string;
};

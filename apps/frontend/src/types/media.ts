export interface MediaFile {
  id: string;
  mediaFileInfo: {
    fileName: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    storageKey: string;
    url: string;
    projectId: string;
    taskId: string;
    uploadedBy: string;
  };
}

export type MediaViewMode = "grid" | "table";

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

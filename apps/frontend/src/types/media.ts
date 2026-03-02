/** Shape used by display components (grid, table, attachments) */
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

/** Raw shape returned by sedjiwa-media GraphQL */
export interface MediaFileRemote {
  id: string;
  publicUrl: string;
  info: {
    fileName: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    storageKey: string;
    projectId: string;
    uploadedBy: string;
  };
}

/** Task-media link from task-management backend */
export interface TaskMediaLink {
  id: string;
  taskMediaLinkData: {
    mediaFileId: string;
    taskId: string;
    projectId: string;
  };
}

/** Map sedjiwa-media response to display shape */
export function mapRemoteToMediaFile(
  remote: MediaFileRemote,
  taskId?: string,
): MediaFile {
  return {
    id: remote.id,
    mediaFileInfo: {
      fileName: remote.info.fileName,
      originalFileName: remote.info.originalFileName,
      mimeType: remote.info.mimeType,
      size: remote.info.size,
      storageKey: remote.info.storageKey,
      url: remote.publicUrl ?? '',
      projectId: remote.info.projectId,
      taskId: taskId ?? "",
      uploadedBy: remote.info.uploadedBy,
    },
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

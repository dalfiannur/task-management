import type { MediaFile as PbMedia } from "@/lib/gen/media_pb";
import { MediaStatus as PbStatus } from "@/lib/gen/media_pb";
import type { MediaFile, MediaStatus } from "../types";

function mapStatus(s: PbStatus): MediaStatus {
  switch (s) {
    case PbStatus.PENDING:
      return "pending";
    case PbStatus.READY:
      return "ready";
    default:
      return "unspecified";
  }
}

export function mapMedia(m: PbMedia): MediaFile {
  return {
    id: m.id,
    projectId: m.projectId,
    fileName: m.fileName,
    originalFileName: m.originalFileName,
    mimeType: m.mimeType,
    size: Number(m.size),
    uploadedBy: m.uploadedBy,
    createdAt: m.createdAt,
    status: mapStatus(m.status),
  };
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

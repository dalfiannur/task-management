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

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "code"
  | "other";

const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "document",
  docx: "document",
  odt: "document",
  rtf: "document",
  txt: "document",
  md: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  json: "code",
  xml: "code",
  html: "code",
  js: "code",
  ts: "code",
  sql: "code",
};

/** What a file is, for its icon and the type filter. MIME first; the
 *  extension settles the many uploads that arrive as octet-stream. */
export function fileKind(file: Pick<MediaFile, "mimeType" | "fileName" | "originalFileName">): FileKind {
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const name = file.originalFileName || file.fileName;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT_KIND[ext] ?? "other";
}

/** Upper-cased extension for the Type column ("PDF", "PNG"), or "—". */
export function fileExtension(file: Pick<MediaFile, "fileName" | "originalFileName">): string {
  const name = file.originalFileName || file.fileName;
  return name.includes(".") ? name.split(".").pop()!.toUpperCase() : "—";
}

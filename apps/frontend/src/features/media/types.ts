// Flat FE type for the media domain, mapped from gen/media_pb.
// int64 `size` (proto → bigint) is narrowed to number for display.

export type MediaStatus = "pending" | "ready" | "unspecified";

export interface MediaFile {
  id: string;
  projectId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  status: MediaStatus;
}

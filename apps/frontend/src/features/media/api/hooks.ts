// Media RPC hooks. Upload is a 3-step orchestration: CreateMediaUpload →
// direct presigned PUT (bypasses Connect) → CompleteMediaUpload.

import { useState } from "react";
import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { MediaService } from "@/lib/gen/media_pb";
import { queryClient } from "@/lib/query";
import type { MediaFile } from "../types";
import { mapMedia } from "./mappers";

function invalidateMedia() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: MediaService,
      cardinality: "finite",
    }),
  });
}

/** Ready files for a project. */
export function useProjectMedia(projectId: string) {
  const result = useQuery(
    MediaService.method.listProjectMedia,
    { projectId },
    { enabled: !!projectId },
  );
  const files: MediaFile[] = (result.data?.files ?? []).map(mapMedia);
  return { ...result, files };
}

export function useDeleteMedia() {
  return useMutation(MediaService.method.deleteMediaFile, {
    onSuccess: invalidateMedia,
  });
}

/** Fetches a fresh presigned GET url on demand (not cached). */
export function useDownloadUrl() {
  return useMutation(MediaService.method.getMediaDownloadUrl);
}

/**
 * Storage rejects a presigned PUT with an XML body — `<Code>` names the real
 * cause (InvalidAccessKeyId, SignatureDoesNotMatch, EntityTooLarge…). Without
 * it the toast only shows a status code and every misconfiguration looks alike.
 */
async function storageErrorDetail(res: Response): Promise<string> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    return "";
  }
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1];
  if (code || message) return [code, message].filter(Boolean).join(": ");
  return body.trim().slice(0, 200);
}

/**
 * Orchestrated upload: reserve a slot + presigned PUT url, upload the bytes
 * straight to storage, then finalize. Refreshes the list on completion.
 */
export function useUploadFile(projectId: string) {
  const create = useMutation(MediaService.method.createMediaUpload);
  const complete = useMutation(MediaService.method.completeMediaUpload);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File): Promise<void> {
    setUploading(true);
    try {
      const { mediaFileId, uploadUrl } = await create.mutateAsync({
        projectId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: BigInt(file.size),
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) {
        const detail = await storageErrorDetail(put);
        throw new Error(
          detail
            ? `Upload failed (${put.status}): ${detail}`
            : `Upload failed (${put.status})`,
        );
      }
      await complete.mutateAsync({ mediaFileId });
      await invalidateMedia();
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}

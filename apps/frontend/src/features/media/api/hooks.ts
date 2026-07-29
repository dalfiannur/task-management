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
        throw new Error(`Upload failed (${put.status})`);
      }
      await complete.mutateAsync({ mediaFileId });
      await invalidateMedia();
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}

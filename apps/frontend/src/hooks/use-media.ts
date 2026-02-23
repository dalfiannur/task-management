import { useState, useEffect, useCallback } from "react";
import { useQuery, gql, getAuthToken } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook } from "@/lib/hook-factories";
import type { MediaFile } from "@/types/media";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace("/graphql", "") ??
  "http://localhost:3000";

const MEDIA_FIELDS = gql`
  fragment MediaFields on MediaFile {
    id
    mediaFileInfo {
      fileName
      originalFileName
      mimeType
      size
      storageKey
      url
      projectId
      taskId
      uploadedBy
    }
  }
`;

const LIST_MEDIA_FILES = gql`
  ${MEDIA_FIELDS}
  query ListMediaFiles($input: listMediaFilesInput!) {
    listMediaFiles(input: $input) {
      ...MediaFields
    }
  }
`;

const GET_MEDIA_FILE = gql`
  ${MEDIA_FIELDS}
  query GetMediaFile($input: getMediaFileInput!) {
    getMediaFile(input: $input) {
      ...MediaFields
    }
  }
`;

const UPDATE_MEDIA_FILE = gql`
  ${MEDIA_FIELDS}
  mutation UpdateMediaFile($input: updateMediaFileInput!) {
    updateMediaFile(input: $input) {
      ...MediaFields
    }
  }
`;

const DELETE_MEDIA_FILE = gql`
  mutation DeleteMediaFile($input: deleteMediaFileInput!) {
    deleteMediaFile(input: $input)
  }
`;

// Simple refetch signal for media list
type RefetchCallback = () => void;
const mediaRefetchCallbacks = new Set<RefetchCallback>();

function triggerMediaRefetch() {
  mediaRefetchCallbacks.forEach((cb) => cb());
}

interface MediaFilters {
  projectId: string;
  taskId?: string;
  mimeType?: string;
}

export function useMediaFiles(filters: MediaFilters) {
  const { data, loading, error, refetch } = useQuery<{
    listMediaFiles: MediaFile[];
  }>(LIST_MEDIA_FILES, {
    variables: {
      input: {
        projectId: filters.projectId,
        taskId: filters.taskId,
        mimeType: filters.mimeType,
      },
    },
  });

  const doRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  // Register for refetch signals
  useEffect(() => {
    mediaRefetchCallbacks.add(doRefetch);
    return () => {
      mediaRefetchCallbacks.delete(doRefetch);
    };
  }, [doRefetch]);

  return {
    data: data?.listMediaFiles,
    isLoading: loading,
    error: error ?? null,
  };
}

export function useMediaFile(id: string) {
  const { data, loading, error } = useQuery<{
    getMediaFile: MediaFile | null;
  }>(GET_MEDIA_FILE, {
    variables: { input: { id } },
    skip: !id,
  });

  return {
    data: data?.getMediaFile ?? null,
    isLoading: loading,
    error: error ?? null,
  };
}

export function useUploadMedia() {
  const [loading, setLoading] = useState(false);

  return {
    mutate: (
      vars: { file: File; projectId: string; taskId?: string },
      opts?: { onSuccess?: (data: MediaFile) => void },
    ) => {
      setLoading(true);
      uploadFile(vars)
        .then((data) => {
          triggerMediaRefetch();
          opts?.onSuccess?.(data);
        })
        .finally(() => setLoading(false));
    },
    mutateAsync: async (vars: {
      file: File;
      projectId: string;
      taskId?: string;
    }): Promise<MediaFile> => {
      setLoading(true);
      try {
        const result = await uploadFile(vars);
        triggerMediaRefetch();
        return result;
      } finally {
        setLoading(false);
      }
    },
    isLoading: loading,
  };
}

async function uploadFile(vars: {
  file: File;
  projectId: string;
  taskId?: string;
}): Promise<MediaFile> {
  const formData = new FormData();
  formData.append("file", vars.file);
  formData.append("projectId", vars.projectId);
  if (vars.taskId) formData.append("taskId", vars.taskId);

  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/media/upload`, {
    method: "POST",
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
  }

  return res.json();
}

export const useDeleteMedia = createVoidMutationHook<string>({
  mutation: DELETE_MEDIA_FILE,
  mapVariables: (id) => ({ input: { id } }),
});

export const useUpdateMedia = createMutationHook<
  { id: string; taskId?: string },
  MediaFile
>({
  mutation: UPDATE_MEDIA_FILE,
  responseKey: "updateMediaFile",
  mapVariables: (vars) => ({
    input: { id: vars.id, taskId: vars.taskId },
  }),
});

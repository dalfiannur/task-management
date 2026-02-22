import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlClient } from "@/lib/graphql-client";
import { gql } from "graphql-request";
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

interface MediaFilters {
  projectId: string;
  taskId?: string;
  mimeType?: string;
}

export function useMediaFiles(filters: MediaFilters) {
  return useQuery({
    queryKey: ["media", filters],
    queryFn: async (): Promise<MediaFile[]> => {
      const data = await graphqlClient.request<{
        listMediaFiles: MediaFile[];
      }>(LIST_MEDIA_FILES, {
        input: {
          projectId: filters.projectId,
          taskId: filters.taskId,
          mimeType: filters.mimeType,
        },
      });
      return data.listMediaFiles;
    },
  });
}

export function useMediaFile(id: string) {
  return useQuery({
    queryKey: ["media", id],
    queryFn: async (): Promise<MediaFile | null> => {
      const data = await graphqlClient.request<{
        getMediaFile: MediaFile | null;
      }>(GET_MEDIA_FILE, { input: { id } });
      return data.getMediaFile;
    },
    enabled: !!id,
  });
}

export function useUploadMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      projectId,
      taskId,
    }: {
      file: File;
      projectId: string;
      taskId?: string;
    }): Promise<MediaFile> => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      if (taskId) formData.append("taskId", taskId);

      const res = await fetch(`${API_BASE}/api/media/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}

export function useDeleteMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const data = await graphqlClient.request<{
        deleteMediaFile: boolean;
      }>(DELETE_MEDIA_FILE, { input: { id } });
      return data.deleteMediaFile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}

export function useUpdateMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      taskId,
    }: {
      id: string;
      taskId?: string;
    }): Promise<MediaFile> => {
      const data = await graphqlClient.request<{
        updateMediaFile: MediaFile;
      }>(UPDATE_MEDIA_FILE, { input: { id, taskId } });
      return data.updateMediaFile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}

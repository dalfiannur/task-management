import { useState, useEffect, useCallback } from "react";
import {
  useQuery,
  gql,
  getAuthToken,
  mediaClient,
  MEDIA_API_BASE,
  client,
} from "@/lib/graphql-client";
import type {
  MediaFile,
  MediaFileRemote,
  TaskMediaLink,
} from "@/types/media";
import { mapRemoteToMediaFile } from "@/types/media";

// --- sedjiwa-media GraphQL operations ---

const MEDIA_FILE_FIELDS = gql`
  fragment MediaFileFields on MediaFile {
    id
    url
    info {
      fileName
      originalFileName
      mimeType
      size
      storageKey
      projectId
      uploadedBy
    }
  }
`;

const LIST_MEDIA_FILES = gql`
  ${MEDIA_FILE_FIELDS}
  query ListMediaFiles($input: listMediaFilesInput!) {
    listMediaFiles(input: $input) {
      ...MediaFileFields
    }
  }
`;

const DELETE_MEDIA_FILE = gql`
  mutation DeleteMediaFile($input: deleteMediaFileInput!) {
    deleteMediaFile(input: $input)
  }
`;

// --- task-management GraphQL operations (visibility / sharing) ---

const SET_MEDIA_FILE_VISIBILITY = gql`
  mutation SetMediaFileVisibility($input: setMediaFileVisibilityInput!) {
    setMediaFileVisibility(input: $input) {
      id
      mediaFileInfo {
        fileName
        originalFileName
        mimeType
        size
        url
        projectId
        visibility
      }
    }
  }
`;

const LIST_SHARED_MEDIA_FILES = gql`
  query ListSharedMediaFiles($input: listSharedMediaFilesInput!) {
    listSharedMediaFiles(input: $input) {
      id
      mediaFileInfo {
        fileName
        originalFileName
        mimeType
        size
        url
        projectId
        visibility
      }
    }
  }
`;

// --- task-management GraphQL operations (links) ---

const TASK_MEDIA_LINK_FIELDS = gql`
  fragment TaskMediaLinkFields on TaskMediaLink {
    id
    taskMediaLinkData {
      mediaFileId
      taskId
      projectId
    }
  }
`;

const LIST_TASK_MEDIA_LINKS = gql`
  ${TASK_MEDIA_LINK_FIELDS}
  query ListTaskMediaLinks($input: listTaskMediaLinksInput!) {
    listTaskMediaLinks(input: $input) {
      ...TaskMediaLinkFields
    }
  }
`;

const LIST_PROJECT_MEDIA_LINKS = gql`
  ${TASK_MEDIA_LINK_FIELDS}
  query ListProjectMediaLinks($input: listProjectMediaLinksInput!) {
    listProjectMediaLinks(input: $input) {
      ...TaskMediaLinkFields
    }
  }
`;

const LINK_MEDIA_FILE = gql`
  ${TASK_MEDIA_LINK_FIELDS}
  mutation LinkMediaFile($input: linkMediaFileInput!) {
    linkMediaFile(input: $input) {
      ...TaskMediaLinkFields
    }
  }
`;

const UNLINK_ALL_FOR_MEDIA_FILE = gql`
  mutation UnlinkAllForMediaFile($input: unlinkAllForMediaFileInput!) {
    unlinkAllForMediaFile(input: $input)
  }
`;

// --- Refetch signal ---

type RefetchCallback = () => void;
const mediaRefetchCallbacks = new Set<RefetchCallback>();

function triggerMediaRefetch() {
  mediaRefetchCallbacks.forEach((cb) => cb());
}

// --- Hooks ---

/** Response shape for MediaFile visibility entries from task-management backend. */
export interface MediaFileVisibilityEntry {
  id: string;
  mediaFileInfo: {
    fileName: string; // stores the sedjiwa-media file ID
    originalFileName: string;
    mimeType: string;
    size: number;
    url: string;
    projectId: string;
    visibility: string;
  };
}

interface MediaFilters {
  projectId: string;
  mediaProjectId?: string;
  taskId?: string;
  mimeType?: string;
  includeShared?: boolean;
}

/**
 * List media files for a project from sedjiwa-media.
 * Fetches project task-media links to determine which files are linked to tasks.
 */
export function useMediaFiles(filters: MediaFilters) {
  const { mediaProjectId, projectId, taskId } = filters;

  // Query sedjiwa-media for files
  const {
    data: mediaData,
    loading: mediaLoading,
    refetch: mediaRefetch,
  } = useQuery<{ listMediaFiles: MediaFileRemote[] }>(LIST_MEDIA_FILES, {
    variables: {
      input: {
        projectId: mediaProjectId,
        ...(filters.mimeType ? { mimeType: filters.mimeType } : {}),
      },
    },
    client: mediaClient,
    skip: !mediaProjectId,
  });

  // Query task-management for project links (to show "Linked" badges)
  const { data: linksData, loading: linksLoading, refetch: linksRefetch } = useQuery<{
    listProjectMediaLinks: TaskMediaLink[];
  }>(LIST_PROJECT_MEDIA_LINKS, {
    variables: { input: { projectId } },
    skip: !projectId,
  });

  // Query visibility entries for this project's files
  const { data: sharedData, refetch: sharedRefetch } = useQuery<{
    listSharedMediaFiles: MediaFileVisibilityEntry[];
  }>(LIST_SHARED_MEDIA_FILES, {
    variables: { input: { projectId } },
    skip: !projectId || !filters.includeShared,
  });

  const doRefetch = useCallback(() => {
    mediaRefetch();
    linksRefetch();
    if (filters.includeShared) sharedRefetch();
  }, [mediaRefetch, linksRefetch, sharedRefetch, filters.includeShared]);

  useEffect(() => {
    mediaRefetchCallbacks.add(doRefetch);
    return () => {
      mediaRefetchCallbacks.delete(doRefetch);
    };
  }, [doRefetch]);

  // Build a map of mediaFileId → taskId from links
  const linkMap = new Map<string, string>();
  for (const link of linksData?.listProjectMediaLinks ?? []) {
    linkMap.set(link.taskMediaLinkData.mediaFileId, link.taskMediaLinkData.taskId);
  }

  // Map remote files to MediaFile shape, enriching with taskId from links
  let files: MediaFile[] = (mediaData?.listMediaFiles ?? []).map((remote) =>
    mapRemoteToMediaFile(remote, linkMap.get(remote.id)),
  );

  // If filtering by taskId, only show files linked to that task
  if (taskId) {
    const linkedFileIds = new Set(
      (linksData?.listProjectMediaLinks ?? [])
        .filter((l) => l.taskMediaLinkData.taskId === taskId)
        .map((l) => l.taskMediaLinkData.mediaFileId),
    );
    files = files.filter((f) => linkedFileIds.has(f.id));
  }

  // Build shared media file IDs set for marking visibility
  const sharedFileIds = new Set(
    (sharedData?.listSharedMediaFiles ?? []).map((e) => e.mediaFileInfo.fileName),
  );

  return {
    data: files,
    sharedFileIds,
    isLoading: mediaLoading || linksLoading,
    error: null,
  };
}

/**
 * List media files linked to a specific task.
 */
export function useTaskMediaFiles(taskId: string, mediaProjectId?: string) {
  const { data: linksData, loading: linksLoading, refetch: linksRefetch } = useQuery<{
    listTaskMediaLinks: TaskMediaLink[];
  }>(LIST_TASK_MEDIA_LINKS, {
    variables: { input: { taskId } },
    skip: !taskId,
  });

  const {
    data: mediaData,
    loading: mediaLoading,
    refetch: mediaRefetch,
  } = useQuery<{ listMediaFiles: MediaFileRemote[] }>(LIST_MEDIA_FILES, {
    variables: { input: { projectId: mediaProjectId } },
    client: mediaClient,
    skip: !mediaProjectId,
  });

  const doRefetch = useCallback(() => {
    linksRefetch();
    mediaRefetch();
  }, [linksRefetch, mediaRefetch]);

  useEffect(() => {
    mediaRefetchCallbacks.add(doRefetch);
    return () => {
      mediaRefetchCallbacks.delete(doRefetch);
    };
  }, [doRefetch]);

  const linkedFileIds = new Set(
    (linksData?.listTaskMediaLinks ?? []).map((l) => l.taskMediaLinkData.mediaFileId),
  );

  const files: MediaFile[] = (mediaData?.listMediaFiles ?? [])
    .filter((remote) => linkedFileIds.has(remote.id))
    .map((remote) => mapRemoteToMediaFile(remote, taskId));

  return {
    data: files,
    isLoading: linksLoading || mediaLoading,
    error: null,
  };
}

/**
 * Upload a file to sedjiwa-media, optionally linking it to a task.
 */
export function useUploadMedia() {
  const [loading, setLoading] = useState(false);

  const uploadAndLink = async (vars: {
    file: File;
    mediaProjectId: string;
    projectId: string;
    taskId?: string;
  }): Promise<MediaFile> => {
    // 1. Upload to sedjiwa-media
    const formData = new FormData();
    formData.append("file", vars.file);
    formData.append("projectId", vars.mediaProjectId);

    const token = getAuthToken();
    const res = await fetch(`${MEDIA_API_BASE}/upload`, {
      method: "POST",
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error ?? "Upload failed");
    }

    const result = await res.json();
    const uploadedFiles = result.files ?? [result];
    const uploaded = uploadedFiles[0];
    const mediaFileId = uploaded.id;

    // 2. If taskId provided, create a link in task-management
    if (vars.taskId) {
      await client.mutate({
        mutation: LINK_MEDIA_FILE,
        variables: {
          input: {
            mediaFileId,
            taskId: vars.taskId,
            projectId: vars.projectId,
          },
        },
      });
    }

    // Map to MediaFile shape
    const info = uploaded.info ?? uploaded.mediaFileInfo ?? {};
    return {
      id: mediaFileId,
      mediaFileInfo: {
        fileName: info.fileName ?? vars.file.name,
        originalFileName: info.originalFileName ?? vars.file.name,
        mimeType: info.mimeType ?? vars.file.type,
        size: info.size ?? vars.file.size,
        storageKey: info.storageKey ?? "",
        url: uploaded.url ?? "",
        projectId: vars.mediaProjectId,
        taskId: vars.taskId ?? "",
        uploadedBy: info.uploadedBy ?? "",
      },
    };
  };

  return {
    mutate: (
      vars: { file: File; mediaProjectId: string; projectId: string; taskId?: string },
      opts?: { onSuccess?: (data: MediaFile) => void },
    ) => {
      setLoading(true);
      uploadAndLink(vars)
        .then((data) => {
          triggerMediaRefetch();
          opts?.onSuccess?.(data);
        })
        .finally(() => setLoading(false));
    },
    mutateAsync: async (vars: {
      file: File;
      mediaProjectId: string;
      projectId: string;
      taskId?: string;
    }): Promise<MediaFile> => {
      setLoading(true);
      try {
        const result = await uploadAndLink(vars);
        triggerMediaRefetch();
        return result;
      } finally {
        setLoading(false);
      }
    },
    isLoading: loading,
  };
}

/**
 * Toggle a media file's visibility between private and shared.
 */
export function useToggleMediaVisibility() {
  const [loading, setLoading] = useState(false);

  interface ToggleVars {
    mediaFileId: string;
    projectId: string;
    visibility: "private" | "shared";
    originalFileName?: string;
    mimeType?: string;
    size?: number;
    url?: string;
  }

  const toggle = async (vars: ToggleVars) => {
    await client.mutate({
      mutation: SET_MEDIA_FILE_VISIBILITY,
      variables: { input: vars },
    });
  };

  return {
    mutate: (
      vars: ToggleVars,
      opts?: { onSuccess?: () => void },
    ) => {
      setLoading(true);
      toggle(vars)
        .then(() => {
          triggerMediaRefetch();
          opts?.onSuccess?.();
        })
        .finally(() => setLoading(false));
    },
    isLoading: loading,
  };
}

/**
 * Fetch shared media files from other projects in the same hierarchy.
 * Returns MediaFile[] built from the backend's visibility entries (includes file metadata).
 */
export function useSharedMediaFiles(
  projectId: string,
  projectNameMap?: Map<string, string>,
) {
  const { data: sharedData, loading: sharedLoading, refetch: sharedRefetch } = useQuery<{
    listSharedMediaFiles: MediaFileVisibilityEntry[];
  }>(LIST_SHARED_MEDIA_FILES, {
    variables: { input: { projectId } },
    skip: !projectId,
  });

  useEffect(() => {
    mediaRefetchCallbacks.add(sharedRefetch);
    return () => {
      mediaRefetchCallbacks.delete(sharedRefetch);
    };
  }, [sharedRefetch]);

  const sharedEntries = sharedData?.listSharedMediaFiles ?? [];

  // Convert visibility entries to MediaFile display objects
  const sharedFiles: MediaFile[] = sharedEntries.map((entry) => ({
    id: entry.mediaFileInfo.fileName, // the sedjiwa-media file ID
    mediaFileInfo: {
      fileName: entry.mediaFileInfo.fileName,
      originalFileName: entry.mediaFileInfo.originalFileName,
      mimeType: entry.mediaFileInfo.mimeType,
      size: entry.mediaFileInfo.size,
      storageKey: "",
      url: entry.mediaFileInfo.url,
      projectId: entry.mediaFileInfo.projectId,
      taskId: "",
      uploadedBy: "",
    },
    visibility: "shared",
    isFromSharedProject: true,
    sourceProjectName: projectNameMap?.get(entry.mediaFileInfo.projectId),
  }));

  return {
    sharedEntries,
    sharedFiles,
    isLoading: sharedLoading,
  };
}

/**
 * Delete a media file from sedjiwa-media and clean up task links.
 */
export function useDeleteMedia() {
  const [loading, setLoading] = useState(false);

  const deleteFile = async (mediaFileId: string) => {
    // 1. Delete all task links for this file
    await client.mutate({
      mutation: UNLINK_ALL_FOR_MEDIA_FILE,
      variables: { input: { mediaFileId } },
    });

    // 2. Delete from sedjiwa-media
    await mediaClient.mutate({
      mutation: DELETE_MEDIA_FILE,
      variables: { input: { id: mediaFileId } },
    });
  };

  return {
    mutate: (mediaFileId: string, opts?: { onSuccess?: () => void }) => {
      setLoading(true);
      deleteFile(mediaFileId)
        .then(() => {
          triggerMediaRefetch();
          opts?.onSuccess?.();
        })
        .finally(() => setLoading(false));
    },
    mutateAsync: async (mediaFileId: string) => {
      setLoading(true);
      try {
        await deleteFile(mediaFileId);
        triggerMediaRefetch();
      } finally {
        setLoading(false);
      }
    },
    isLoading: loading,
  };
}

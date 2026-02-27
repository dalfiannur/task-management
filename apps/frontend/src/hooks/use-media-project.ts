import { useState, useEffect } from "react";
import { gql, mediaClient } from "@/lib/graphql-client";

// --- GraphQL operations (sedjiwa-media) ---

const LIST_MEDIA_PROJECTS = gql`
  query ListMediaProjects($input: listProjectsInput!) {
    listProjects(input: $input) {
      id
      info {
        name
        slug
        coreProjectId
      }
    }
  }
`;

const CREATE_MEDIA_PROJECT = gql`
  mutation CreateMediaProject($input: createProjectInput!) {
    createProject(input: $input) {
      id
      info {
        name
        slug
        coreProjectId
      }
    }
  }
`;

// --- Session-level cache ---

const mediaProjectCache = new Map<string, string>();

/**
 * Resolves a task-management projectId to a sedjiwa-media project ID.
 * Uses coreProjectId (from task-mgmt project's coreRef) to look up or create
 * a corresponding MediaProject in sedjiwa-media.
 */
export function useResolveMediaProjectId(
  coreProjectId: string | undefined,
  projectName: string,
): { mediaProjectId: string | null; isLoading: boolean } {
  const [mediaProjectId, setMediaProjectId] = useState<string | null>(() =>
    coreProjectId ? mediaProjectCache.get(coreProjectId) ?? null : null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!coreProjectId) return;

    // Already cached
    const cached = mediaProjectCache.get(coreProjectId);
    if (cached) {
      setMediaProjectId(cached);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        // Try to find existing media project by coreProjectId
        const { data: listData } = await mediaClient.query<{
          listProjects: { id: string; info: { name: string; slug: string; coreProjectId: string } }[];
        }>({
          query: LIST_MEDIA_PROJECTS,
          variables: { input: { coreProjectId } },
          fetchPolicy: "network-only",
        });

        const projects = listData?.listProjects ?? [];
        if (projects.length > 0) {
          const id = projects[0].id;
          mediaProjectCache.set(coreProjectId, id);
          if (!cancelled) setMediaProjectId(id);
          return;
        }

        // Not found — create one
        const { data: createData } = await mediaClient.mutate<{
          createProject: { id: string; info: { name: string; slug: string; coreProjectId: string } };
        }>({
          mutation: CREATE_MEDIA_PROJECT,
          variables: {
            input: { name: projectName, coreProjectId },
          },
        });

        const id = createData?.createProject?.id;
        if (id) {
          mediaProjectCache.set(coreProjectId, id);
          if (!cancelled) setMediaProjectId(id);
        }
      } catch (err) {
        console.error("[useResolveMediaProjectId] Failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coreProjectId, projectName]);

  return { mediaProjectId, isLoading };
}

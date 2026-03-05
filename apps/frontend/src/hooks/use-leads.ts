import { useQuery, gql, coreClient, salesClient, mediaClient } from "@/lib/graphql-client";
import { createMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CoreProject } from "@/types/project";

const LIST_LEADS = gql`
  query ListLeadProjects($input: listProjectsInput!) {
    listProjects(input: $input) {
      id
      code
      status
      winStage
      commercial
      name {
        description
        name
      }
      ref {
        companyId
        leaderId
      }
    }
  }
`;

const APPROVE_LEAD = gql`
  mutation ApproveLeadProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      id
      code
      status
      winStage
      name {
        description
        name
      }
    }
  }
`;

export function useNewLeads(ownerId?: string) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_LEADS, {
    client: coreClient,
    variables: { input: { winStage: "pending", ownerId } },
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export const useApproveLead = createMutationHook<
  { id: string; winStage: string },
  CoreProject
>({
  mutation: APPROVE_LEAD,
  responseKey: "updateProject",
  client: coreClient,
  refetchQueries: [LIST_LEADS],
});

const GET_DEAL_BY_PROJECT_ID = gql`
  query GetDealByProjectId($input: getDealByProjectIdInput!) {
    getDealByProjectId(input: $input) {
      id
      brief {
        briefDescription
        briefFileUrl
        briefFileName
      }
    }
  }
`;

interface DealBriefRaw {
  id: string;
  brief?: {
    briefDescription: string;
    briefFileUrl: string;
    briefFileName: string;
  } | null;
}

export interface DealBrief {
  briefDescription: string;
  briefFileUrls: string[];
  briefFileNames: string[];
}

function parseDealBrief(raw: DealBriefRaw | null): DealBrief | null {
  if (!raw?.brief) return null;
  const { briefDescription, briefFileUrl, briefFileName } = raw.brief;
  return {
    briefDescription,
    briefFileUrls: briefFileUrl ? JSON.parse(briefFileUrl) : [],
    briefFileNames: briefFileName ? JSON.parse(briefFileName) : [],
  };
}

export function useDealBrief(projectId?: string) {
  const result = useQuery<{ getDealByProjectId: DealBriefRaw | null }>(
    GET_DEAL_BY_PROJECT_ID,
    {
      client: salesClient,
      variables: { input: { projectId } },
      skip: !projectId,
    }
  );
  return normalizeQueryResult(result, (d) => parseDealBrief(d.getDealByProjectId));
}

// ---------------------------------------------------------------------------
// Media files for a core project (uploaded via AttachmentsCard in sales-pipeline)
// ---------------------------------------------------------------------------

const LIST_MEDIA_PROJECTS_BY_CORE = gql`
  query ListMediaProjectsByCoreId($input: listProjectsInput!) {
    listProjects(input: $input) {
      id
    }
  }
`;

const LIST_MEDIA_FILES = gql`
  query ListProjectMediaFiles($input: listMediaFilesInput!) {
    listMediaFiles(input: $input) {
      id
      url
      info {
        originalFileName
        mimeType
      }
    }
  }
`;

export interface ProjectMediaFile {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
}

export function useProjectMediaFiles(coreProjectId?: string) {
  const { data: projectData, loading: projectLoading } = useQuery<{
    listProjects: Array<{ id: string }>;
  }>(LIST_MEDIA_PROJECTS_BY_CORE, {
    client: mediaClient,
    variables: { input: { coreProjectId } },
    skip: !coreProjectId,
  });

  const mediaProjectId = projectData?.listProjects?.[0]?.id;

  const { data: filesData, loading: filesLoading } = useQuery<{
    listMediaFiles: Array<{ id: string; url: string; info: { originalFileName: string; mimeType: string } }>;
  }>(LIST_MEDIA_FILES, {
    client: mediaClient,
    variables: { input: { projectId: mediaProjectId } },
    skip: !mediaProjectId,
  });

  const files: ProjectMediaFile[] = (filesData?.listMediaFiles ?? []).map((f) => ({
    id: f.id,
    url: f.url,
    fileName: f.info.originalFileName,
    mimeType: f.info.mimeType,
  }));

  return { files, isLoading: projectLoading || filesLoading };
}

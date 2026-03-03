import { useQuery, gql, coreClient, salesClient, mediaClient } from "@/lib/graphql-client";
import { createMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { Project, ProjectStatus } from "@/types/project";

const LIST_PROJECTS = gql`
  query ListLeadProjects {
    listProjects(input: {winStage: pending}) {
      id
      code
      name {
        description
        name
      }
      status
      winStage
      ref {
        companyId
      }
    }
  }
`;

const APPROVE_PROJECT = gql`
  mutation ApproveLeadProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      id
      code
      name {
        description
        name
      }
      status
      winStage
    }
  }
`;

/** Raw Core project shape from the Core GraphQL API. */
interface CoreProjectRaw {
  id: string;
  code: string;
  name: { name: string; description: string };
  status: string;
  winStage: string;
  ref?: { companyId: string };
}

function mapCoreProject(p: CoreProjectRaw): Project {
  return {
    id: p.id,
    coreRef: { value: p.id },
    status: { value: p.status as ProjectStatus },
    description: p.name.description,
    code: p.code,
    coreName: p.name.name,
    coreDescription: p.name.description,
    winStage: p.winStage,
    companyId: p.ref?.companyId,
  };
}

export function useNewLeads() {
  const result = useQuery<{ listProjects: CoreProjectRaw[] }>(LIST_PROJECTS, {
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listProjects.map(mapCoreProject));
}

export const useApproveLead = createMutationHook<
  { id: string; winStage: string },
  CoreProjectRaw
>({
  mutation: APPROVE_PROJECT,
  responseKey: "updateProject",
  client: coreClient,
  refetchQueries: [LIST_PROJECTS],
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

export function useDealBrief(projectId?: string, companyId?: string) {
  const result = useQuery<{ getDealByProjectId: DealBriefRaw | null }>(
    GET_DEAL_BY_PROJECT_ID,
    {
      client: salesClient,
      context: { headers: { 'X-Company-Id': companyId ?? '' } },
      variables: { input: { projectId } },
      skip: !projectId || !companyId,
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

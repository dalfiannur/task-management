const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:3101/graphql";

const CACHE_TTL_MS = 60_000;

export interface CoreProject {
  id: string;
  code: string;
  name: { name: string; description: string };
  clientDetail?: { name: { name: string; legalName: string } } | null;
  status: string;
  winStage: string;
  ref: { leaderId: string; clientId: string };
}

interface CacheEntry {
  data: CoreProject | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(id: string): CoreProject | null | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(id);
    return undefined;
  }
  return entry.data;
}

function setCache(id: string, data: CoreProject | null) {
  cache.set(id, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const CORE_PROJECT_FIELDS = `
  id
  code
  name { name description }
  clientDetail {
    name { name legalName }
  }
  status
  winStage
  ref { leaderId clientId }
`;

const CORE_PROJECT_QUERY = `
  query GetCoreProject($input: getProjectInput!) {
    getProject(input: $input) {
      ${CORE_PROJECT_FIELDS}
    }
  }
`;

const CORE_PROJECTS_BATCH_QUERY = `
  query GetCoreProjectsByIds($input: getProjectsByIdsInput!) {
    getProjectsByIds(input: $input) {
      ${CORE_PROJECT_FIELDS}
    }
  }
`;

export async function fetchCoreProject(
  id: string,
  authToken: string | null,
): Promise<CoreProject | null> {
  const cached = getCached(id);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(CORE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        query: CORE_PROJECT_QUERY,
        variables: { input: { id } },
      }),
    });

    const json = (await res.json()) as {
      data?: { getProject: CoreProject | null };
    };
    const project = json.data?.getProject ?? null;
    setCache(id, project);
    return project;
  } catch (err) {
    console.error(`[core-client] fetchCoreProject failed for id=${id}:`, err);
    setCache(id, null);
    return null;
  }
}

export async function fetchCoreProjects(
  ids: string[],
  authToken: string | null,
): Promise<Map<string, CoreProject>> {
  const map = new Map<string, CoreProject>();
  const uncachedIds: string[] = [];

  for (const id of ids) {
    const cached = getCached(id);
    if (cached !== undefined) {
      if (cached) map.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length === 0) return map;

  try {
    const res = await fetch(CORE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        query: CORE_PROJECTS_BATCH_QUERY,
        variables: { input: { ids: uncachedIds } },
      }),
    });

    const json = (await res.json()) as {
      data?: { getProjectsByIds: CoreProject[] };
    };
    const projects = json.data?.getProjectsByIds ?? [];
    const fetched = new Set<string>();

    for (const project of projects) {
      setCache(project.id, project);
      map.set(project.id, project);
      fetched.add(project.id);
    }

    // Cache misses as null
    for (const id of uncachedIds) {
      if (!fetched.has(id)) setCache(id, null);
    }
  } catch (err) {
    console.error(`[core-client] fetchCoreProjects batch failed for ids=${uncachedIds.join(",")}:`, err);
    // Cache all as null on failure
    for (const id of uncachedIds) setCache(id, null);
  }

  return map;
}

const CORE_PROJECT_FIELDS_MINIMAL = `
  id
  code
  name { name description }
  status
  winStage
  ref { leaderId clientId }
`;

const CREATE_CORE_PROJECT_MUTATION = `
  mutation CreateCoreProject($input: createProjectInput!) {
    createProject(input: $input) {
      ${CORE_PROJECT_FIELDS_MINIMAL}
    }
  }
`;

export interface CreateCoreProjectInput {
  name: string;
  description?: string;
  clientId?: string;
  authorId: string;
  parentId?: string;
  ownerId?: string;
  divisionId?: string;
  commercial?: boolean;
  value?: number;
  projectLeaderId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  winStage?: string;
}

export async function createCoreProject(
  input: CreateCoreProjectInput,
  authToken: string | null,
): Promise<CoreProject> {
  const res = await fetch(CORE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      query: CREATE_CORE_PROJECT_MUTATION,
      variables: { input },
    }),
  });

  const json = (await res.json()) as {
    data?: { createProject: CoreProject };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Core API error: ${json.errors[0].message}`);
  }

  const project = json.data?.createProject;
  if (!project) {
    throw new Error("Core API returned no project data");
  }

  setCache(project.id, project);
  return project;
}

const DELETE_CORE_PROJECT_MUTATION = `
  mutation DeleteCoreProject($input: deleteProjectInput!) {
    deleteProject(input: $input)
  }
`;

export async function deleteCoreProject(
  id: string,
  authToken: string | null,
): Promise<boolean> {
  const res = await fetch(CORE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      query: DELETE_CORE_PROJECT_MUTATION,
      variables: { input: { id } },
    }),
  });

  const json = (await res.json()) as {
    data?: { deleteProject: boolean };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Core API error: ${json.errors[0].message}`);
  }

  cache.delete(id);
  return json.data?.deleteProject ?? false;
}

const USER_COMPANIES_QUERY = `
  query ListUserCompanies($input: listUserCompaniesInput!) {
    listUserCompanies(input: $input) { companyRef }
  }
`;

export async function fetchUserCompanyIds(
  userId: string,
  authToken: string | null,
): Promise<string[]> {
  try {
    const res = await fetch(CORE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        query: USER_COMPANIES_QUERY,
        variables: { input: { userRefId: userId, limit: 100 } },
      }),
    });

    const json = (await res.json()) as {
      data?: { listUserCompanies: { companyRef: string }[] | null };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      console.error(`[core-client] fetchUserCompanyIds errors for userId=${userId}:`, json.errors);
    }

    return (json.data?.listUserCompanies ?? []).map((m) => m.companyRef);
  } catch (err) {
    console.error(`[core-client] fetchUserCompanyIds failed for userId=${userId}:`, err);
    return [];
  }
}

export function extractAuthToken(request?: Request): string | null {
  if (!request) return null;
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

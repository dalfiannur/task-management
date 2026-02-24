const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:3200/graphql";

const CACHE_TTL_MS = 60_000;

export interface CoreProject {
  id: string;
  code: string;
  name: { name: string; description: string };
  clientDetail?: { name: { name: string; legalName: string } } | null;
  status: string;
  winStage: string;
  ref: { leaderId: string };
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
  ref { leaderId }
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
  } catch {
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
  } catch {
    // Cache all as null on failure
    for (const id of uncachedIds) setCache(id, null);
  }

  return map;
}

export function extractAuthToken(request?: Request): string | null {
  if (!request) return null;
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

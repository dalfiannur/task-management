import { useQuery, gql, coreClient } from "@/lib/graphql-client";
import type { User } from "@/types/task";

// --- GraphQL operations (Core Portal) ---

const SEARCH_USERS = gql`
  query SearchUsers($input: searchUsersInput!) {
    searchUsers(input: $input) {
      id
      info {
        displayName
        email
        avatarUrl
      }
    }
  }
`;

const GET_USER = gql`
  query GetUser($input: getUserInput!) {
    getUser(input: $input) {
      id
      info {
        displayName
        email
        avatarUrl
      }
    }
  }
`;

// --- Response interfaces ---

interface CoreUserResponse {
  id: string;
  info: {
    displayName: string;
    email: string;
    avatarUrl: string;
  };
}

// --- Mapper ---

function mapCoreUser(raw: CoreUserResponse): User {
  return {
    id: raw.id,
    externalId: raw.id,
    email: raw.info.email,
    name: raw.info.displayName,
    avatarUrl: raw.info.avatarUrl || undefined,
  };
}

// --- Hooks ---

export function useSearchUsers(query: string) {
  const { data, loading, error } = useQuery<{
    searchUsers: CoreUserResponse[];
  }>(SEARCH_USERS, {
    variables: { input: { q: query } },
    skip: !query || query.length < 1,
    client: coreClient,
  });

  return {
    data: data?.searchUsers.map(mapCoreUser),
    isLoading: loading,
    error: error ?? null,
  };
}

export function useUser(id: string | undefined) {
  const { data, loading, error } = useQuery<{
    getUser: CoreUserResponse;
  }>(GET_USER, {
    variables: { input: { id } },
    skip: !id,
    client: coreClient,
  });

  return {
    data: data?.getUser ? mapCoreUser(data.getUser) : undefined,
    isLoading: loading,
    error: error ?? null,
  };
}

// Re-export for consumers that still import SEARCH_USERS directly
export { SEARCH_USERS, type CoreUserResponse, mapCoreUser };

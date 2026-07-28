import { useQuery, gql } from "@/lib/graphql-client";
import type { User } from "@/types/task";

const SEARCH_USERS = gql`query SearchUsers($input: searchUsersInput!) { searchUsers(input: $input) }`;
const GET_USER = gql`query GetUser($input: getUserInput!) { getUser(input: $input) }`;

interface LocalUserResponse {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

function mapLocalUser(raw: LocalUserResponse): User {
  return {
    id: raw.id,
    externalId: raw.id,
    email: raw.email,
    name: raw.displayName,
    avatarUrl: raw.avatarUrl || undefined,
  };
}

export function useSearchUsers(query: string) {
  const { data, loading, error } = useQuery<{ searchUsers: LocalUserResponse[] }>(SEARCH_USERS, {
    variables: { input: { q: query } },
  });
  return {
    data: data?.searchUsers.map(mapLocalUser),
    isLoading: loading,
    error: error ?? null,
  };
}

export function useUser(id: string | undefined) {
  const { data, loading, error } = useQuery<{ getUser: LocalUserResponse | null }>(GET_USER, {
    variables: { input: { id } },
    skip: !id,
  });
  return {
    data: data?.getUser ? mapLocalUser(data.getUser) : undefined,
    isLoading: loading,
    error: error ?? null,
  };
}

export { SEARCH_USERS, type LocalUserResponse, mapLocalUser };

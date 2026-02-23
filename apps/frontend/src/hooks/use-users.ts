import { useQuery, gql, oidcClient } from "@/lib/graphql-client";
import { useAuth } from "react-oidc-context";
import type { User } from "@/types/task";

interface OidcUser {
  id: string;
  profile: {
    displayName: string;
    avatarUrl: string;
  };
}

const SEARCH_USERS = gql`
  query SearchUsers($input: searchUsersInput!) {
    searchUsers(input: $input) {
      users {
        id
        profile {
          displayName
          avatarUrl
        }
      }
      total
    }
  }
`;

function mapOidcUser(u: OidcUser): User {
  return {
    id: u.id,
    externalId: u.id,
    email: "",
    name: u.profile.displayName,
    avatarUrl: u.profile.avatarUrl || undefined,
  };
}

export function useUsers() {
  const auth = useAuth();
  const token = auth.user?.access_token;

  const { data, loading, error } = useQuery<{
    searchUsers: { users: OidcUser[]; total: number };
  }>(SEARCH_USERS, {
    variables: { input: {} },
    skip: !token,
    client: oidcClient,
  });

  return {
    data: data?.searchUsers.users.map(mapOidcUser),
    isLoading: loading,
    error: error ?? null,
  };
}

export function useUser(id: string | undefined) {
  const { data: users } = useUsers();

  return {
    data: users?.find((u) => u.id === id),
    isLoading: false,
    error: null,
  };
}

import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";
import { useAuth } from "react-oidc-context";
import { oidcGraphClient } from "@/lib/graphql-client";
import type { User } from "@/types/task";

interface OidcUser {
  id: string;
  profile: {
    displayName: string;
    avatarUrl: string;
  }
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
`

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
  return useQuery({
    queryKey: ["users", token],
    enabled: !!token,
    retry: false,
    queryFn: async (): Promise<User[]> => {
      const res = await oidcGraphClient.request<{
        searchUsers: {
          users: OidcUser[],
          total: number
        }
      }>(SEARCH_USERS, { input: {} })

      return res.searchUsers.users.map(mapOidcUser)
    },
  });
}

export function useUser(id: string | undefined) {
  const { data: users } = useUsers();
  return useQuery({
    queryKey: ["users", id],
    queryFn: async (): Promise<User | undefined> => {
      return users?.find((u) => u.id === id);
    },
    enabled: !!id && !!users,
  });
}

import { useQuery, gql, client } from "@/lib/graphql-client";
import { useAuth } from "react-oidc-context";
import type { User } from "@/types/task";

interface TaskUser {
  id: string;
  userProfile: {
    externalId: string;
    email: string;
    name: string;
    avatarUrl: string;
    role: string;
  };
}

const LIST_USERS = gql`
  query ListUsers {
    listUsers {
      id
      userProfile {
        externalId
        email
        name
        avatarUrl
        role
      }
    }
  }
`;

function mapTaskUser(u: TaskUser): User {
  return {
    id: u.userProfile.externalId,
    externalId: u.userProfile.externalId,
    email: u.userProfile.email,
    name: u.userProfile.name,
    avatarUrl: u.userProfile.avatarUrl || undefined,
  };
}

export function useUsers() {
  const auth = useAuth();
  const token = auth.user?.access_token;

  const { data, loading, error } = useQuery<{
    listUsers: TaskUser[];
  }>(LIST_USERS, {
    variables: {},
    skip: !token,
    client: client,
  });

  return {
    data: data?.listUsers.map(mapTaskUser),
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

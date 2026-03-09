import { useQuery, gql, oidcClient } from "@/lib/graphql-client";

const ME_QUERY = gql`
  query Me {
    me {
      id
      profile {
        displayName
      }
      isAdmin
    }
  }
`;

export interface MeData {
  id: string;
  profile: {
    displayName: string;
  };
  role: "manager" | "member";
}

interface MeResponse {
  me: {
    id: string;
    profile: {
      displayName: string;
    };
    isAdmin: boolean;
  } | null;
}

export function useMe() {
  const { data, loading, error } = useQuery<MeResponse>(ME_QUERY, {
    client: oidcClient,
    fetchPolicy: "cache-and-network",
  });

  const meData: MeData | null = data?.me
    ? {
        id: data.me.id,
        profile: data.me.profile,
        role: data.me.isAdmin ? "manager" : "member",
      }
    : data === undefined
      ? (undefined as unknown as null)
      : null;

  return {
    data: meData,
    isLoading: loading,
    error: error ?? null,
  };
}

export function useIsManager(): boolean {
  const { data } = useMe();
  return data?.role === "manager";
}

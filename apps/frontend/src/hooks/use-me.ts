import { useQuery, gql } from "@/lib/graphql-client";
import { useAuthStore } from "@/stores/auth-store";

const ME_QUERY = gql`query Me($input: meInput!) { me(input: $input) }`;

export interface MeData {
  id: string;
  profile: { displayName: string };
  role: "manager" | "member";
  isAdmin: boolean;
}

interface MeResponse {
  me: {
    id: string;
    displayName: string;
    isAdmin: boolean;
  } | null;
}

export function useMe() {
  const { data, loading, error } = useQuery<MeResponse>(ME_QUERY, {
    variables: { input: {} },
    fetchPolicy: "cache-and-network",
  });

  const meData: MeData | null = data?.me
    ? {
        id: data.me.id,
        profile: { displayName: data.me.displayName },
        role: data.me.isAdmin ? "manager" : "member",
        isAdmin: data.me.isAdmin,
      }
    : null;

  return { data: meData, isLoading: loading, error: error ?? null };
}

export function useIsManager(): boolean {
  return useAuthStore((s) => s.isAdmin);
}

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.isAdmin);
}

export function useHasPermission(_resource: string, _action: string): boolean {
  // Local model collapses to admin vs member: admins can do everything.
  return useAuthStore((s) => s.isAdmin);
}

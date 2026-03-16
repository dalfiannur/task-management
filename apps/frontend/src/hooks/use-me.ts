import { useQuery, gql, oidcClient } from "@/lib/graphql-client";
import { useAuth } from "react-oidc-context";

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
  isAdmin: boolean;
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
        isAdmin: data.me.isAdmin,
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

export function useIsAdmin(): boolean {
  const auth = useAuth();
  try {
    const token = auth.user?.access_token;
    if (!token) return false;
    const payload = JSON.parse(atob(token.split(".")[1]));
    const permissions: string[] = payload.permissions ?? [];
    return permissions.includes("*");
  } catch {
    return false;
  }
}

function hasPermission(userPermissions: string[], resource: string, action: string): boolean {
  if (userPermissions.includes("*")) return true;
  if (userPermissions.includes(`${resource}:${action}`)) return true;
  if (userPermissions.includes(`${resource}:manage`)) return true;

  // _all variant implies the base permission (e.g. read_all grants read)
  if (userPermissions.includes(`${resource}:${action}_all`)) return true;

  // Parent-level manage: "media:manage" grants all "media:*:*" actions
  const segments = resource.split(":");
  for (let i = segments.length - 1; i >= 1; i--) {
    const parent = segments.slice(0, i).join(":");
    if (userPermissions.includes(`${parent}:manage`)) return true;
  }

  return false;
}

export function useHasPermission(resource: string, action: string): boolean {
  const auth = useAuth();
  try {
    const token = auth.user?.access_token;
    if (!token) return false;
    const payload = JSON.parse(atob(token.split(".")[1]));
    const permissions: string[] = payload.permissions ?? [];
    return hasPermission(permissions, resource, action);
  } catch {
    return false;
  }
}

import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";
import { oidcGraphClient } from "@/lib/graphql-client";

const ME_QUERY = gql`
  query Me {
    me {
      id
      profile {
        displayName
      }
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
  } | null;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<MeData | null> => {
      const data = await oidcGraphClient.request<MeResponse>(ME_QUERY);
      console.log({ data })
      if (!data.me) return null;
      return {
        id: data.me.id,
        profile: data.me.profile,
        role: "manager",
      };
    },
  });
}

export function useIsManager(): boolean {
  const { data } = useMe();
  return data?.role === "manager";
}

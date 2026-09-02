// Personal access token RPC hooks (connect-query over AccessTokenService).
// Entirely self-scoped on the server, so there's no owner parameter here.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { AccessTokenService } from "@/lib/gen/tokens_pb";
import { queryClient } from "@/lib/query";
import type { AccessToken } from "../types";
import { mapToken } from "./mappers";

function invalidateTokens() {
  return queryClient.invalidateQueries({
    queryKey: createConnectQueryKey({
      schema: AccessTokenService,
      cardinality: "finite",
    }),
  });
}

export function useTokens() {
  const result = useQuery(AccessTokenService.method.listTokens, {});
  const tokens: AccessToken[] = (result.data?.tokens ?? []).map(mapToken);
  return { ...result, tokens };
}

export function useCreateToken() {
  return useMutation(AccessTokenService.method.createToken, {
    onSuccess: invalidateTokens,
  });
}

export function useRevokeToken() {
  return useMutation(AccessTokenService.method.revokeToken, {
    onSuccess: invalidateTokens,
  });
}

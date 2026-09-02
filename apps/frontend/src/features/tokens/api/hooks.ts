// Personal access token RPC hooks (connect-query over AccessTokenService).
// Entirely self-scoped on the server, so there's no owner parameter here.

import {
  useMutation,
  useQuery,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { AccessTokenService } from "@/lib/gen/tokens_pb";
import { queryClient } from "@/lib/query";
import type { AccessToken, CreatedToken } from "../types";
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
  const mutation = useMutation(AccessTokenService.method.createToken, {
    onSuccess: invalidateTokens,
  });
  // The plaintext exists only in this response and is never fetchable again,
  // so unlike every other create mutation in this app the caller does need
  // `.data` — but flattened, so the proto shape stops at this boundary
  // (CLAUDE.md: "components never touch proto message shapes"). `created`
  // being defined is also what the dialog gates its one-time "show it now"
  // stage on, instead of reasoning about `mutation.data.token` truthiness.
  const created: CreatedToken | undefined = mutation.data?.accessToken
    ? { plaintext: mutation.data.token, token: mapToken(mutation.data.accessToken) }
    : undefined;
  return { ...mutation, created };
}

export function useRevokeToken() {
  return useMutation(AccessTokenService.method.revokeToken, {
    onSuccess: invalidateTokens,
  });
}

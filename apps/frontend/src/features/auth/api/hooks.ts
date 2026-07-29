// Auth RPC hooks (connect-query over the shared transport). Login/Register write
// the persisted session atom on success so the interceptor and route guards see
// the new principal immediately.

import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useSetAtom } from "jotai";
import { AuthService } from "@/lib/gen/users_pb";
import { queryClient } from "@/lib/query";
import { EMPTY_SESSION } from "../types";
import { sessionAtom } from "../atoms/session";
import { mapUser } from "./mappers";

/** Current principal (server truth). Enabled only when a token is present. */
export function useMe(enabled = true) {
  const result = useQuery(AuthService.method.me, {}, { enabled });
  return {
    ...result,
    user: result.data ? mapUser(result.data) : null,
  };
}

/** Sign in → persist { token, user }. */
export function useLogin() {
  const setSession = useSetAtom(sessionAtom);
  return useMutation(AuthService.method.login, {
    onSuccess(res) {
      setSession({
        token: res.token,
        user: res.user ? mapUser(res.user) : null,
      });
    },
  });
}

/** Self-register → returns the pending user (no session until an admin approves). */
export function useRegister() {
  return useMutation(AuthService.method.register);
}

/** Clear the session and drop all cached queries. */
export function useLogout() {
  const setSession = useSetAtom(sessionAtom);
  return () => {
    setSession(EMPTY_SESSION);
    queryClient.clear();
  };
}

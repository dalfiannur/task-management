// Auth RPC hooks (connect-query over the shared transport). Login/Register write
// the persisted session atom on success so the interceptor and route guards see
// the new principal immediately.

import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useSetAtom } from "jotai";
import { AuthService } from "@/lib/gen/users_pb";
import { client } from "@/lib/connect";
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

/**
 * Whether this instance still has no accounts, and so may run first-run setup.
 *
 * Called from route loaders rather than from React, so it uses the raw client:
 * `/setup` and `/login` each need the answer before they decide whether to
 * render or bounce, and a hook would only produce that answer after a render.
 */
export async function fetchSetupNeeded(): Promise<boolean> {
  const { needed } = await client(AuthService).setupStatus({});
  return needed;
}

/**
 * Create the one Active admin on an empty instance and sign in as it.
 *
 * Stores the session exactly as `useLogin` does — the server returns the same
 * LoginResponse, because the outcome is the same: an authenticated admin.
 */
export function useSetupFirstAdmin() {
  const setSession = useSetAtom(sessionAtom);
  return useMutation(AuthService.method.setupFirstAdmin, {
    onSuccess(res) {
      setSession({
        token: res.token,
        user: res.user ? mapUser(res.user) : null,
      });
    },
  });
}

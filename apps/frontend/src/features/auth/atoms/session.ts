// Auth session state (Jotai). `sessionAtom` is the single source of truth —
// persisted to localStorage and read by the Connect auth interceptor (via the
// default store, so the interceptor stays hook-free).

import { atom, getDefaultStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { setTokenGetter } from "@/lib/connect";
import { EMPTY_SESSION, type Session } from "../types";

const STORAGE_KEY = "sedjiwa.auth";

// `getOnInit: true` makes the atom read localStorage synchronously at init, so
// the route guard / interceptor see the persisted token on the very first read
// (a full page load or refresh) — without it they'd read EMPTY_SESSION until an
// effect hydrates, and bounce authenticated users to /login.
export const sessionAtom = atomWithStorage<Session>(
  STORAGE_KEY,
  EMPTY_SESSION,
  undefined,
  { getOnInit: true },
);

export const tokenAtom = atom((get) => get(sessionAtom).token);
export const currentUserAtom = atom((get) => get(sessionAtom).user);
export const isAuthedAtom = atom((get) => get(sessionAtom).token != null);
export const isAdminAtom = atom((get) => get(sessionAtom).user?.isAdmin ?? false);

/** Wire the Connect interceptor's token getter to the persisted session. */
export function wireAuthTransport(): void {
  const store = getDefaultStore();
  setTokenGetter(() => store.get(sessionAtom).token);
}

// Wire on import so the interceptor has a live token source even before bootstrap.
wireAuthTransport();

// Auth feature barrel — cross-feature consumers import from here, not deep paths.

export type { AppUser, Session, UserStatus } from "./types";
export { EMPTY_SESSION } from "./types";
export {
  sessionAtom,
  tokenAtom,
  currentUserAtom,
  isAuthedAtom,
  isAdminAtom,
  wireAuthTransport,
} from "./atoms/session";
export { mapUser } from "./api/mappers";
export { useMe, useLogin, useRegister, useLogout } from "./api/hooks";

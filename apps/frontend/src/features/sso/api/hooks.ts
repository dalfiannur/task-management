// Single sign-on through the Sedjiwa Portal (optional backend module). The
// browser leaves for the portal through a plain link to the backend's
// /sso/start; it comes back to /sso/callback with a one-time code that is
// redeemed here for the same session a password login gives.

import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useSetAtom } from "jotai";
import { SsoService } from "@/lib/gen/sso_pb";
import { mapUser, sessionAtom } from "@/features/auth";

/** Whether SSO is configured, and the portal's display name. */
export function useSsoConfig() {
  const result = useQuery(SsoService.method.getSsoConfig, {}, { staleTime: 5 * 60_000, retry: false });
  return {
    ...result,
    enabled: result.data?.enabled ?? false,
    providerName: result.data?.providerName || "Sedjiwa Portal",
  };
}

/** One-time code → session (persisted like a password login). */
export function useRedeemSsoCode() {
  const setSession = useSetAtom(sessionAtom);
  return useMutation(SsoService.method.redeemSsoCode, {
    onSuccess(res) {
      setSession({ token: res.token, user: res.user ? mapUser(res.user) : null });
    },
  });
}

/** The backend URL that starts a portal sign-in and returns to `redirect`. */
export function ssoStartUrl(redirect?: string): string {
  const q = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  return `/api/tasks-rs/sso/start${q}`;
}

/** What went wrong, for the callback page. Keys come from crates/sso. */
export function ssoErrorMessage(key: string): string {
  switch (key) {
    case "denied":
      return "The portal sign-in was cancelled or refused.";
    case "code":
      return "This sign-in link has expired or was opened in a different browser. Please sign in again.";
    case "expired":
      return "This sign-in took too long or was started in another browser. Please try again.";
    case "no_phone":
      return "Your portal account has no phone number. Add one in the portal, then try again.";
    case "phone_unverified":
      return "An account here already uses your phone number, but the portal has not verified it. Verify your number in the portal, or sign in with your password.";
    case "verify_phone":
      return "Your phone number is not verified in the portal yet. Verify it in the portal, then sign in again.";
    case "ambiguous":
      return "More than one account here uses your phone number. Ask an admin to sort it out.";
    case "linked_elsewhere":
      return "The account with your phone number is already linked to a different portal account. Ask an admin.";
    case "inactive":
      return "Your account is not active. Ask an admin to activate it.";
    case "disabled":
      return "Single sign-on is not set up on this site.";
    case "provider":
      return "Could not complete the sign-in with the portal. Please try again in a moment.";
    case "busy":
      return "Too many sign-ins in progress. Please try again in a moment.";
    default:
      return "Single sign-on failed. Please try again.";
  }
}

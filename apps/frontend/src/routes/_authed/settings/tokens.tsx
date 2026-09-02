import { createFileRoute } from "@tanstack/react-router";
import { TokensPage } from "@/features/tokens";

/**
 * Personal access token settings. No extra guard needed: `_authed` already
 * requires a session, and every RPC on this page is self-scoped on the server.
 */
export const Route = createFileRoute("/_authed/settings/tokens")({
  component: TokensPage,
});

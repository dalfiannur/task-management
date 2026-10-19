import { createFileRoute } from "@tanstack/react-router";
import { SsoCallback } from "@/features/sso";

type Search = { code?: string; error?: string; redirect?: string };

export const Route = createFileRoute("/sso/callback")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    code: typeof s.code === "string" ? s.code : undefined,
    error: typeof s.error === "string" ? s.error : undefined,
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: CallbackPage,
});

function CallbackPage() {
  const { code, error, redirect } = Route.useSearch();
  return <SsoCallback code={code} error={error} redirect={redirect} />;
}

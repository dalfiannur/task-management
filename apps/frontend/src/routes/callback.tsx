import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import z from "zod";

const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/callback")({
  validateSearch: loginSearchSchema,
  component: CallbackPage,
});

function CallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { redirect: redirectPath } = Route.useSearch();

  useEffect(() => {
    if (auth.isLoading) return;

    if (auth.isAuthenticated) {
      const storedPath = sessionStorage.getItem("oidc_redirect_path");
      if (storedPath) sessionStorage.removeItem("oidc_redirect_path");
      navigate({ to: storedPath ?? redirectPath ?? "/dashboard" });
      return;
    }

    // If URL has code param, oidc-client-ts is processing the callback — wait
    const params = new URLSearchParams(window.location.search);
    if (params.has("code")) return;

    // Not authenticated and not processing callback — initiate login
    if (redirectPath) {
      sessionStorage.setItem("oidc_redirect_path", redirectPath);
    }
    auth.signinRedirect();
  }, [auth.isLoading, auth.isAuthenticated]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchSetupNeeded } from "@/features/auth";
import { LoginForm } from "@/features/auth/components/login-form";

export const Route = createFileRoute("/login")({
  // A brand-new instance has no account to sign in with, so send people to
  // setup instead of to a form that cannot succeed. Paired with the redirect
  // the other way in /setup, every entry point lands somewhere usable: the
  // _authed guard bounces here, and here bounces on. Costs one COUNT per
  // visit to the login page.
  beforeLoad: async () => {
    if (await fetchSetupNeeded()) {
      throw redirect({ to: "/setup" });
    }
  },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  return <LoginForm redirect={redirect} />;
}

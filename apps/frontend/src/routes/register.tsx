import { createFileRoute } from "@tanstack/react-router";
import { RegisterForm } from "@/features/auth/components/register-form";
import { SsoSignIn } from "@/features/sso";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  // Signing in through the portal also creates the account (active at once).
  return <RegisterForm extra={<SsoSignIn label="Sign up" />} />;
}

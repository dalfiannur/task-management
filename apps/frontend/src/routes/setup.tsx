import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchSetupNeeded } from "@/features/auth";
import { SetupForm } from "@/features/auth/components/setup-form";

/**
 * First-run only. Asks the server — never the client — whether the instance is
 * still empty, and bounces to /login the moment it is not. The server refuses
 * SetupFirstAdmin on the same condition, so this redirect is about not showing
 * a dead form, not about keeping anyone out.
 */
export const Route = createFileRoute("/setup")({
  beforeLoad: async () => {
    if (!(await fetchSetupNeeded())) {
      throw redirect({ to: "/login" });
    }
  },
  component: SetupForm,
});

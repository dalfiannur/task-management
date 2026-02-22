import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Logo */}
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary">
          <svg viewBox="0 0 16 16" fill="none" className="size-8">
            <path
              d="M2 4.5A2.5 2.5 0 014.5 2h2a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4A.5.5 0 012 6.5v-2zM9 2.5a.5.5 0 01.5-.5h2A2.5 2.5 0 0114 4.5v2a.5.5 0 01-.5.5h-4a.5.5 0 01-.5-.5v-4zM2 9.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2A2.5 2.5 0 012 11.5v-2zM9.5 9a.5.5 0 00-.5.5v2A2.5 2.5 0 0011.5 14h2a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-4z"
              fill="currentColor"
              className="text-primary-foreground"
            />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks Manager</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your projects and tasks in one place.
          </p>
        </div>

        {/* Sign In */}
        <Button asChild size="lg">
          <Link to="/callback">Sign In</Link>
        </Button>
      </div>
    </div>
  );
}

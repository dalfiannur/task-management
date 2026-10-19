import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button, Input, Label, Card, CardContent, CardDescription, CardHeader, CardTitle } from "sedjiwa-ui";
import { APP_NAME } from "@/lib/app-config";
import { safeAppPath } from "@/lib/utils";
import { useLogin } from "../api/hooks";

/**
 * Phone + password sign-in. On success navigates to `redirect` (or /dashboard).
 * `extra` renders under the form (other ways to sign in, e.g. SSO).
 */
export function LoginForm({ redirect, extra }: { redirect?: string; extra?: ReactNode }) {
  const navigate = useNavigate();
  const login = useLogin();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { phone, password },
      {
        onSuccess: () => {
          // Only ever back onto this site.
          const target = safeAppPath(redirect);
          if (target) window.location.assign(target);
          else navigate({ to: "/dashboard" });
        },
        onError: (err) => toast.error(err.message || "Sign in failed"),
      },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>{APP_NAME}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input.Root>
                <Input.Field
                  id="phone"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </Input.Root>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input.Root>
                <Input.Field
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Input.Root>
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {extra}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link to="/register" className="underline">
              Register
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

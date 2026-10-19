import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button, Input, Label, Card, CardContent, CardDescription, CardHeader, CardTitle } from "sedjiwa-ui";
import { useRegister } from "../api/hooks";

/** Self-registration → account lands `pending` until an admin approves it. */
/** Self-registration. `extra` renders under the form (e.g. SSO). */
export function RegisterForm({ extra }: { extra?: ReactNode } = {}) {
  const navigate = useNavigate();
  const register = useRegister();
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    register.mutate(
      { phone, displayName, password },
      {
        onSuccess: () => {
          toast.success("Registered — awaiting admin approval.");
          navigate({ to: "/login" });
        },
        onError: (err) => toast.error(err.message || "Registration failed"),
      },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>
            Accounts registered with this form need admin approval before sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Name</Label>
              <Input.Root>
                <Input.Field
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </Input.Root>
            </div>
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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Input.Root>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={register.isPending}
            >
              {register.isPending ? "Registering…" : "Register"}
            </Button>
          </form>
          {extra}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button, Input, Label, Card, CardContent, CardDescription, CardHeader, CardTitle } from "sedjiwa-ui";
import { APP_NAME } from "@/lib/app-config";
import { useSetupFirstAdmin } from "../api/hooks";

const MIN_PASSWORD = 8;

/**
 * First-run: create the one administrator and sign in as it.
 *
 * Wears the same Card shell as sign-in and register on purpose. The thing worth
 * raising on this screen is not its chrome but its copy — whoever sees it has
 * no context at all, and needs to know that this account becomes the
 * administrator and that the page will not be here again.
 */
export function SetupForm() {
  const navigate = useNavigate();
  const setup = useSetupFirstAdmin();
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Checked here only to spare a round trip and to keep the message next to the
  // field; the server enforces the same minimum and is what actually holds.
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    phone.trim() !== "" &&
    displayName.trim() !== "" &&
    password.length >= MIN_PASSWORD &&
    confirm === password;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setup.mutate(
      { phone: phone.trim(), password, displayName: displayName.trim() },
      {
        onSuccess: () => navigate({ to: "/dashboard" }),
        onError: (err) => toast.error(err.message || "Setup failed"),
      },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up {APP_NAME}</CardTitle>
          <CardDescription>
            This account becomes the administrator: it approves everyone who
            registers afterwards. You will only see this page once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-name">Name</Label>
              <Input.Root>
                <Input.Field
                  id="setup-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  required
                />
              </Input.Root>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-phone">Phone</Label>
              <Input.Root>
                <Input.Field
                  id="setup-phone"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </Input.Root>
              <p className="text-xs text-muted-foreground">
                This is the number you will sign in with.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-password">Password</Label>
              <Input.Root aria-invalid={tooShort || undefined}>
                <Input.Field
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby="setup-password-hint"
                />
              </Input.Root>
              <p
                id="setup-password-hint"
                className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                At least {MIN_PASSWORD} characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-confirm">Confirm password</Label>
              <Input.Root aria-invalid={mismatch || undefined}>
                <Input.Field
                  id="setup-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  aria-describedby={mismatch ? "setup-confirm-error" : undefined}
                />
              </Input.Root>
              {mismatch && (
                <p id="setup-confirm-error" className="text-xs text-destructive">
                  Both passwords must match.
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!ready || setup.isPending}
            >
              {setup.isPending ? "Creating…" : "Create admin account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

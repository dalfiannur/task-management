import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Code } from "@connectrpc/connect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "sedjiwa-ui";
import { safeAppPath } from "@/lib/utils";
import { ssoErrorMessage, useRedeemSsoCode } from "../api/hooks";

/** Back from the portal: redeem the one-time code, then go where the user was headed. */
export function SsoCallback({ code, error, redirect }: { code?: string; error?: string; redirect?: string }) {
  const navigate = useNavigate();
  const redeem = useRedeemSsoCode();
  const [failure, setFailure] = useState<string | null>(error ? ssoErrorMessage(error) : null);
  // The code works once; React's dev double-effect must not spend it twice.
  const started = useRef(false);
  const { mutateAsync } = redeem;

  useEffect(() => {
    if (error || !code || started.current) return;
    started.current = true;
    // The promise, not mutate()'s callbacks: those are dropped when the
    // component remounts (StrictMode), which left the page stuck here.
    mutateAsync({ code }).then(
      () => {
        const target = safeAppPath(redirect);
        if (target && target !== "/") {
          window.location.assign(target);
        } else {
          navigate({ to: "/dashboard", replace: true });
        }
      },
      (e: { code?: Code; rawMessage?: string }) =>
        setFailure(
          // An unknown, used or expired code, or one opened in another browser.
          e.code === Code.Unauthenticated ? ssoErrorMessage("code") : e.rawMessage || ssoErrorMessage(""),
        ),
    );
  }, [code, error, redirect, navigate, mutateAsync]);

  // Landed here with neither a code nor an error: nothing to finish.
  const message = failure ?? (!code ? ssoErrorMessage("") : null);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{message ? "Sign-in failed" : "Signing you in…"}</CardTitle>
          {message && <CardDescription>{message}</CardDescription>}
        </CardHeader>
        <CardContent>
          {message ? (
            <Link to="/login" className="text-sm underline">
              Back to sign in
            </Link>
          ) : (
            <Skeleton className="h-4 w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

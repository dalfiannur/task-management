import { LogIn } from "lucide-react";
import { buttonVariants } from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import { ssoStartUrl, useSsoConfig } from "../api/hooks";

/** "Sign in with Sedjiwa Portal", under the password form. Hidden when SSO is off. */
export function SsoSignIn({ redirect, label = "Sign in" }: { redirect?: string; label?: string }) {
  const { enabled, providerName } = useSsoConfig();
  if (!enabled) return null;
  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {/* A real navigation, not fetch: the browser must go to the portal and back. */}
      <a href={ssoStartUrl(redirect)} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
        <LogIn className="mr-2 h-4 w-4" />
        {label} with {providerName}
      </a>
    </div>
  );
}

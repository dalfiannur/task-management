import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";

export function Component() {
  const logout = useAuthStore((s) => s.logout);
  useEffect(() => {
    logout();
    // Hard redirect (not SPA nav) so logout always loads fresh app code and
    // never fails on a stale code-split chunk after a redeploy.
    window.location.replace("/login");
  }, [logout]);
  return null;
}

import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";

export function Component() {
  const logout = useAuthStore((s) => s.logout);
  useEffect(() => { logout(); }, [logout]);
  return <Navigate to="/login" replace />;
}

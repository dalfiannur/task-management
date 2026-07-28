import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";

export function Component() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

import { useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import styles from "./callback.module.css";

export function Component() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get("redirect") ?? undefined;

  useEffect(() => {
    if (auth.isLoading) return;

    if (auth.isAuthenticated) {
      const storedPath = sessionStorage.getItem("oidc_redirect_path");
      if (storedPath) sessionStorage.removeItem("oidc_redirect_path");
      navigate(storedPath ?? redirectPath ?? "/dashboard");
      return;
    }

    // If URL has code param, oidc-client-ts is processing the callback — wait
    const params = new URLSearchParams(window.location.search);
    if (params.has("code")) return;

    // Not authenticated and not processing callback — initiate login
    if (redirectPath) {
      sessionStorage.setItem("oidc_redirect_path", redirectPath);
    }
    auth.signinRedirect();
  }, [auth.isLoading, auth.isAuthenticated]);

  return (
    <div className={styles.page}>
      <Loader2 className={styles.spinner} />
    </div>
  );
}

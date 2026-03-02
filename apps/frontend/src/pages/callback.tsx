import { useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAuth } from "react-oidc-context";
import styles from "./callback.module.css";

export function Component() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectPath = searchParams.get("redirect") ?? undefined;
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (auth.isLoading) return;

    if (auth.isAuthenticated) {
      const storedPath = sessionStorage.getItem("oidc_redirect_path");
      if (storedPath) sessionStorage.removeItem("oidc_redirect_path");
      navigate(storedPath ?? redirectPath ?? "/dashboard", { replace: true });
      return;
    }

    if (auth.error) {
      redirectingRef.current = false;
      return;
    }

    // oidc-client-ts is mid-exchange (signinRedirect or signinCallback in flight)
    if (auth.activeNavigator) return;

    if (redirectingRef.current) return;
    redirectingRef.current = true;

    if (redirectPath) {
      sessionStorage.setItem("oidc_redirect_path", redirectPath);
    }
    auth.signinRedirect();
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, navigate, redirectPath]);

  if (auth.error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>Authentication failed</p>
          <p className={styles.errorDetail}>{auth.error.message}</p>
          <button
            className={styles.retryButton}
            onClick={() => {
              redirectingRef.current = false;
              auth.signinRedirect();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Loader2 className={styles.spinner} />
    </div>
  );
}

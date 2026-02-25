import { Navigate, Link } from "react-router";
import { useAuth } from "react-oidc-context";
import { Button } from "@/components/ui/button";
import styles from "./landing.module.css";

export function Component() {
  const auth = useAuth();

  if (auth.isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* Logo */}
        <div className={styles.logoBox}>
          <svg viewBox="0 0 16 16" fill="none" className={styles.logoSvg}>
            <path
              d="M2 4.5A2.5 2.5 0 014.5 2h2a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-4A.5.5 0 012 6.5v-2zM9 2.5a.5.5 0 01.5-.5h2A2.5 2.5 0 0114 4.5v2a.5.5 0 01-.5.5h-4a.5.5 0 01-.5-.5v-4zM2 9.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2A2.5 2.5 0 012 11.5v-2zM9.5 9a.5.5 0 00-.5.5v2A2.5 2.5 0 0011.5 14h2a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-4z"
              fill="currentColor"
              className={styles.logoPath}
            />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h1 className={styles.title}>Tasks Manager</h1>
          <p className={styles.subtitle}>
            Manage your projects and tasks in one place.
          </p>
        </div>

        {/* Sign In */}
        <Button asChild size="lg">
          <Link to="/callback">Sign In</Link>
        </Button>
      </div>
    </div>
  );
}

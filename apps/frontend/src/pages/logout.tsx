import { useNavigate } from "react-router";
import { useAuth } from "react-oidc-context";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import styles from "./logout.module.css";

export function Component() {
  const auth = useAuth();
  const navigate = useNavigate();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    auth.signoutRedirect().catch(() => {
      // signoutRedirect failed — clear local session and go to landing
      auth.removeUser().then(() => {
        navigate("/", { replace: true });
      });
    });
  }, [auth, navigate]);

  return (
    <div className={styles.page}>
      <Loader2 className={styles.spinner} />
    </div>
  );
}

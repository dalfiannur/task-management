import { useNavigate } from "react-router";
import { useAuth } from "react-oidc-context";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import styles from "./logout.module.css";

export function Component() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    auth.removeUser().then(() => {
      navigate("/callback");
    });
  }, []);

  return (
    <div className={styles.page}>
      <Loader2 className={styles.spinner} />
    </div>
  );
}

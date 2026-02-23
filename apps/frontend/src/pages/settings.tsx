import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import styles from "./settings.module.css";

export function Component() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Manage your application settings</CardDescription>
        </CardHeader>
        <CardContent>
          <p className={styles.placeholder}>Settings coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}

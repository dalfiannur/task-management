import styles from "./property-row.module.css";

interface PropertyRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}

export function PropertyRow({ icon: Icon, label, children }: PropertyRowProps) {
  return (
    <div className={styles.propertyRow}>
      <div className={styles.propertyLabel}>
        <Icon className={styles.propertyIcon} />
        <span className={styles.propertyLabelText}>{label}</span>
      </div>
      <div className={styles.propertyValue}>{children}</div>
    </div>
  );
}

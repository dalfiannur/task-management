import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompanyStore } from "@/stores/company-store";
import { resetAllStores } from "@/lib/graphql-client";
import { Building2 } from "lucide-react";
import styles from "./company-selector.module.css";

export function CompanySelector() {
  const { companies, selectedCompanyId, selectCompany, isLoading } =
    useCompanyStore();

  if (isLoading || companies.length === 0) return null;

  function handleChange(value: string) {
    selectCompany(value);
    resetAllStores();
  }

  // Single company — just show the name, no dropdown
  if (companies.length === 1) {
    return (
      <div className={styles.single}>
        <Building2 className={styles.icon} />
        <span className={styles.name}>{companies[0].name}</span>
      </div>
    );
  }

  return (
    <Select value={selectedCompanyId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className={styles.trigger}>
        <Building2 className={styles.icon} />
        <SelectValue placeholder="Select company" />
      </SelectTrigger>
      <SelectContent>
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

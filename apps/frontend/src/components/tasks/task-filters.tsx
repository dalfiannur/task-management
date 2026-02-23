import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from "@/types/task";
import styles from "./task-filters.module.css";

interface TaskFiltersProps {
  filters: {
    status?: string;
    priority?: string;
    assignee?: string;
    label?: string;
  };
}

export function TaskFilters({ filters }: TaskFiltersProps) {
  const [, setSearchParams] = useSearchParams();

  const updateFilter = (key: string, value: string | undefined) => {
    setSearchParams((prev) => {
      if (value) {
        prev.set(key, value);
      } else {
        prev.delete(key);
      }
      prev.set("page", "1");
      return prev;
    });
  };

  const clearFilters = () => {
    setSearchParams({ sort: "order", page: "1" });
  };

  const hasFilters = filters.status || filters.priority || filters.assignee || filters.label;

  return (
    <div className={styles.container}>
      <Select
        value={filters.status ?? "all"}
        onValueChange={(v) => updateFilter("status", v === "all" ? undefined : v)}
      >
        <SelectTrigger className={styles.filterTrigger}>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          {Object.entries(TASK_STATUS_CONFIG).map(([value, config]) => (
            <SelectItem key={value} value={value}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priority ?? "all"}
        onValueChange={(v) => updateFilter("priority", v === "all" ? undefined : v)}
      >
        <SelectTrigger className={styles.filterTrigger}>
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priority</SelectItem>
          {Object.entries(TASK_PRIORITY_CONFIG).map(([value, config]) => (
            <SelectItem key={value} value={value}>
              {config.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className={styles.clearButton}>
          <X className={styles.clearIcon} />
          Clear
        </Button>
      )}
    </div>
  );
}

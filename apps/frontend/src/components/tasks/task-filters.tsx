import { useNavigate } from "@tanstack/react-router";
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

interface TaskFiltersProps {
  filters: {
    status?: string;
    priority?: string;
    assignee?: string;
    label?: string;
  };
}

export function TaskFilters({ filters }: TaskFiltersProps) {
  const navigate = useNavigate();

  const updateFilter = (key: string, value: string | undefined) => {
    navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        [key]: value,
        page: 1,
      })) as never,
    });
  };

  const clearFilters = () => {
    navigate({
      search: { sort: "order", page: 1 } as never,
    });
  };

  const hasFilters = filters.status || filters.priority || filters.assignee || filters.label;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={filters.status ?? "all"}
        onValueChange={(v) => updateFilter("status", v === "all" ? undefined : v)}
      >
        <SelectTrigger className="w-[140px] h-8">
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
        <SelectTrigger className="w-[140px] h-8">
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
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

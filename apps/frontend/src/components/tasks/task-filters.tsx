import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/shared/search-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Users, Search, ChevronDown } from "lucide-react";
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from "@/types/task";
import { useProjectMembers } from "@/hooks/use-members";
import { useUser } from "@/hooks/use-users";
import styles from "./task-filters.module.css";

function MemberCheckboxItem({
  userId,
  checked,
  onToggle,
  search,
}: {
  userId: string;
  checked: boolean;
  onToggle: () => void;
  search: string;
}) {
  const { data: user } = useUser(userId);
  const name = user?.name ?? userId;

  if (search && !name.toLowerCase().includes(search.toLowerCase())) {
    return null;
  }

  return (
    <label className={styles.memberItem}>
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className={styles.memberName}>{name}</span>
    </label>
  );
}

interface TaskFiltersProps {
  projectId?: string;
  filters: {
    status?: string;
    priority?: string;
    assignees?: string[];
    label?: string;
  };
}

export function TaskFilters({ projectId, filters }: TaskFiltersProps) {
  const [, setSearchParams] = useSearchParams();
  const { data: members } = useProjectMembers(projectId ?? "");
  const [memberSearch, setMemberSearch] = useState("");

  const selectedAssignees = filters.assignees ?? [];

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

  const toggleAssignee = (userId: string) => {
    const next = selectedAssignees.includes(userId)
      ? selectedAssignees.filter((id) => id !== userId)
      : [...selectedAssignees, userId];
    updateFilter("assignee", next.length > 0 ? next.join(",") : undefined);
  };

  const clearFilters = () => {
    setSearchParams({ sort: "order", page: "1" });
  };

  const hasFilters = filters.status || filters.priority || selectedAssignees.length > 0 || filters.label;

  return (
    <div className={styles.container}>
      <SearchSelect
        options={[
          { value: "all", label: "All Status" },
          ...Object.entries(TASK_STATUS_CONFIG).map(([value, config]) => ({
            value,
            label: config.label,
          })),
        ]}
        value={filters.status ?? "all"}
        onChange={(v) => updateFilter("status", v === "all" || !v ? undefined : v)}
        getOptionValue={(o) => o.value}
        getOptionLabel={(o) => o.label}
        filterLocally
        clearable={false}
        variant="pill"
        placeholder="Status"
        className="w-[140px]"
      />

      <SearchSelect
        options={[
          { value: "all", label: "All Priority" },
          ...Object.entries(TASK_PRIORITY_CONFIG).map(([value, config]) => ({
            value,
            label: config.label,
          })),
        ]}
        value={filters.priority ?? "all"}
        onChange={(v) => updateFilter("priority", v === "all" || !v ? undefined : v)}
        getOptionValue={(o) => o.value}
        getOptionLabel={(o) => o.label}
        filterLocally
        clearable={false}
        variant="pill"
        placeholder="Priority"
        className="w-[140px]"
      />

      {members && members.length > 0 && (
        <Popover onOpenChange={(open) => { if (!open) setMemberSearch(""); }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm transition-all hover:border-gray-300 hover:bg-gray-50"
            >
              <Users className="size-3.5 opacity-50" />
              {selectedAssignees.length > 0
                ? `${selectedAssignees.length} selected`
                : "Assignee"}
              <ChevronDown className="size-3.5 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className={styles.assigneePopover} align="start">
            <div className={styles.searchBox}>
              <Search className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
            </div>
            <div className={styles.memberList}>
              {members.map((m) => (
                <MemberCheckboxItem
                  key={m.membership.userId}
                  userId={m.membership.userId}
                  checked={selectedAssignees.includes(m.membership.userId)}
                  onToggle={() => toggleAssignee(m.membership.userId)}
                  search={memberSearch}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className={styles.clearButton}>
          <X className={styles.clearIcon} />
          Clear
        </Button>
      )}
    </div>
  );
}

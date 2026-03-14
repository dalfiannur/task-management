import { useState, useRef } from "react";
import { Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateLabel } from "@/hooks/use-labels";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "./search-dropdown";

const LABEL_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

interface LabelComboboxProps {
  value: string[];
  labels: { id: string; name: string; color: string }[];
  onChange: (labelIds: string[]) => void;
  projectId?: string;
}

interface LabelOption extends SearchDropdownOption {
  color: string;
}

export function LabelCombobox({ value, labels, onChange, projectId }: LabelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const createLabel = useCreateLabel();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabels = labels.filter((l) => value.includes(l.id));

  const hasExactMatch = labels.some(
    (l) => l.name.toLowerCase() === search.trim().toLowerCase(),
  );

  const handleCreate = () => {
    if (!projectId || !search.trim()) return;
    const color = LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)];
    const name = search.trim();
    setSearch("");
    createLabel.mutate(
      { name, color, projectId },
      {
        onSuccess: (newLabel) => {
          onChange([...value, newLabel.id]);
        },
      },
    );
  };

  const dropdownOptions: LabelOption[] = labels.map((l) => ({
    value: l.id,
    label: l.name,
    color: l.color,
  }));

  return (
    <div ref={containerRef} className="relative">
      {/* Pill trigger */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full h-7 px-3 text-xs font-bold border-0 shadow-none transition-colors cursor-pointer",
          selectedLabels.length > 0
            ? "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300"
            : "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400",
        )}
      >
        {selectedLabels.length > 0 ? (
          <>
            <div className="flex items-center gap-1 min-w-0 flex-wrap">
              {selectedLabels.slice(0, 2).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 text-xs font-medium"
                >
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate max-w-[60px]">{label.name}</span>
                </span>
              ))}
              {selectedLabels.length > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{selectedLabels.length - 2}
                </span>
              )}
            </div>
            <X
              className="size-3 text-muted-foreground/50 shrink-0 hover:text-foreground transition-colors ml-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          </>
        ) : (
          <>
            <Tag className="size-3.5" />
            <span className="text-xs font-medium">Add label</span>
          </>
        )}
      </button>

      {/* Dropdown */}
      <SearchDropdown
        open={open}
        onClose={() => setOpen(false)}
        containerRef={containerRef}
        options={dropdownOptions}
        isSelected={(o) => value.includes(o.value)}
        onSelect={(o) => {
          const isSelected = value.includes(o.value);
          onChange(
            isSelected
              ? value.filter((id) => id !== o.value)
              : [...value, o.value],
          );
        }}
        searchValue={search}
        onSearchChange={setSearch}
        filterLocally={true}
        searchPlaceholder="Search labels..."
        emptyText="No labels found."
        width="w-[200px]"
        renderOption={(option: LabelOption) => (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: option.color }}
            />
            {option.label}
          </div>
        )}
        footer={
          <>
            {search.trim() && !hasExactMatch && projectId && (
              <div className="border-t border-border/50 p-1">
                <button
                  type="button"
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={handleCreate}
                  disabled={createLabel.isLoading}
                >
                  <Plus className="size-3.5" />
                  {createLabel.isLoading ? "Creating..." : <>Create &ldquo;{search.trim()}&rdquo;</>}
                </button>
              </div>
            )}
            {value.length > 0 && (
              <div className={cn("border-t border-border p-1", search.trim() && !hasExactMatch && projectId && "border-t-0")}>
                <button
                  type="button"
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-destructive rounded-md hover:bg-destructive/10 transition-colors cursor-pointer"
                  onClick={() => {
                    onChange([]);
                    setOpen(false);
                  }}
                >
                  <X className="size-3" />
                  Remove all
                </button>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}

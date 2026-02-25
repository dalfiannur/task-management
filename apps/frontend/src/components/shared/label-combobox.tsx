import { useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateLabel } from "@/hooks/use-labels";
import styles from "./label-combobox.module.css";

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

export function LabelCombobox({ value, labels, onChange, projectId }: LabelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const createLabel = useCreateLabel();
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={styles.trigger}
        >
          {selectedLabels.length > 0 ? (
            <>
              <div className={styles.selectedLabels}>
                {selectedLabels.slice(0, 3).map((label) => (
                  <span
                    key={label.id}
                    className={styles.labelChip}
                  >
                    <span
                      className={styles.labelDot}
                      style={{ backgroundColor: label.color }}
                    />
                    <span className={styles.labelName}>{label.name}</span>
                  </span>
                ))}
                {selectedLabels.length > 3 && (
                  <span className={styles.overflowCount}>
                    +{selectedLabels.length - 3}
                  </span>
                )}
              </div>
              <X
                className={styles.clearIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className={styles.emptyPlaceholder}>None</span>
              <ChevronsUpDown className={styles.chevron} />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className={styles.popover} align="start">
        <Command>
          <CommandInput
            placeholder="Search labels..."
            className={styles.searchInput}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className={styles.emptyMessage}>
              No labels found.
            </CommandEmpty>
            <CommandGroup>
              {labels.map((label) => {
                const isSelected = value.includes(label.id);
                return (
                  <CommandItem
                    key={label.id}
                    value={label.name}
                    onSelect={() => {
                      onChange(
                        isSelected
                          ? value.filter((id) => id !== label.id)
                          : [...value, label.id],
                      );
                    }}
                    className={styles.labelItem}
                  >
                    <span
                      className={styles.labelColorDot}
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    <Check
                      className={cn(
                        styles.checkIcon,
                        isSelected ? styles.checkVisible : styles.checkHidden,
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {search.trim() && !hasExactMatch && projectId && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create_${search}`}
                  onSelect={handleCreate}
                  className={styles.createItem}
                >
                  <Plus className={styles.createIcon} />
                  Create &ldquo;{search.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

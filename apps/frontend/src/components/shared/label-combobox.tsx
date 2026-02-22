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
          className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-xs hover:bg-muted/50 transition-colors w-full"
        >
          {selectedLabels.length > 0 ? (
            <>
              <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                {selectedLabels.slice(0, 3).map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted"
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="truncate max-w-[60px]">{label.name}</span>
                  </span>
                ))}
                {selectedLabels.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{selectedLabels.length - 3}
                  </span>
                )}
              </div>
              <X
                className="size-3 ml-auto text-muted-foreground/50 hover:text-foreground shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            </>
          ) : (
            <>
              <span className="text-muted-foreground">None</span>
              <ChevronsUpDown className="size-3 ml-auto text-muted-foreground/40 shrink-0" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search labels..."
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">
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
                    className="text-xs"
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0 mr-1.5"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    <Check
                      className={cn(
                        "ml-auto size-3.5",
                        isSelected ? "opacity-100" : "opacity-0",
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
                  className="text-xs"
                >
                  <Plus className="size-3.5 mr-1.5" />
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

import { useState, useRef } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
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
  const clearingRef = useRef(false);
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
    <Popover open={open} onOpenChange={(v) => {
      if (clearingRef.current) {
        clearingRef.current = false;
        return;
      }
      setOpen(v);
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg h-8 transition-colors cursor-pointer",
            selectedLabels.length > 0
              ? "px-2.5 border border-border bg-background hover:bg-muted/50 shadow-sm"
              : "px-3 text-muted-foreground hover:text-foreground hover:bg-muted/50",
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
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Search labels..."
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-2 text-xs text-center">
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
                      className="size-2 rounded-full shrink-0 mr-1.5"
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
                  disabled={createLabel.isLoading}
                >
                  <Plus className="size-3.5 mr-1.5" />
                  {createLabel.isLoading ? "Creating..." : <>Create &ldquo;{search.trim()}&rdquo;</>}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-destructive rounded-md hover:bg-destructive/10 transition-colors cursor-pointer"
              onClick={() => {
                clearingRef.current = true;
                onChange([]);
                setTimeout(() => setOpen(false), 0);
              }}
            >
              <X className="size-3" />
              Remove all
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

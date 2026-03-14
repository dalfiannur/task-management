import { useState, useRef, useCallback, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "./search-dropdown";

interface SearchSelectProps<T> {
  options: T[];
  value?: string;
  onChange: (value: string | undefined) => void;
  getOptionValue: (option: T) => string;
  getOptionLabel: (option: T) => string;
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  filterLocally?: boolean;
  renderOption?: (option: T, isSelected: boolean) => ReactNode;
  renderSelected?: (option: T) => ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  variant?: "default" | "pill";
}

export function SearchSelect<T>({
  options,
  value,
  onChange,
  getOptionValue,
  getOptionLabel,
  searchValue,
  onSearchChange,
  filterLocally = true,
  renderOption,
  renderSelected,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  clearable = true,
  className,
  variant = "default",
}: SearchSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => getOptionValue(o) === value);

  // Map options to SearchDropdownOption shape
  const dropdownOptions: (SearchDropdownOption & { _original: T })[] =
    options.map((o) => ({
      value: getOptionValue(o),
      label: getOptionLabel(o),
      _original: o,
    }));

  const handleSelect = useCallback(
    (option: SearchDropdownOption & { _original: T }) => {
      onChange(option.value === value ? undefined : option.value);
      setOpen(false);
    },
    [onChange, value],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2 text-sm transition-all",
          variant === "pill"
            ? "rounded-full border border-border bg-background px-3 py-1.5 hover:border-border/80 hover:bg-muted/50"
            : "rounded-lg border border-border bg-background px-4 py-2.5 hover:border-border/80",
          variant === "pill" && open && "border-border/80 bg-muted/50",
          variant !== "pill" && open && "border-blue-500 ring-2 ring-blue-100",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="flex-1 truncate text-left">
          {selectedOption ? (
            renderSelected ? (
              renderSelected(selectedOption)
            ) : (
              getOptionLabel(selectedOption)
            )
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {clearable && value && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
            />
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 opacity-50 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {/* Dropdown */}
      <SearchDropdown
        open={open}
        onClose={() => setOpen(false)}
        containerRef={containerRef}
        options={dropdownOptions}
        isSelected={(o) => o.value === value}
        onSelect={handleSelect}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        filterLocally={filterLocally}
        renderOption={
          renderOption
            ? (o, sel) => renderOption(o._original, sel)
            : undefined
        }
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        align="start"
        width="w-full"
      />
    </div>
  );
}

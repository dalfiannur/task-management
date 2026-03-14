import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";
import { Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchDropdownOption {
  value: string;
  label: string;
}

interface SearchDropdownProps<T extends SearchDropdownOption> {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  options: T[];
  isSelected: (option: T) => boolean;
  onSelect: (option: T) => void;
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  filterLocally?: boolean;
  renderOption?: (option: T, isSelected: boolean) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  align?: "start" | "end";
  width?: string;
}

export function SearchDropdown<T extends SearchDropdownOption>({
  open,
  onClose,
  containerRef,
  options,
  isSelected,
  onSelect,
  searchValue: controlledSearch,
  onSearchChange,
  filterLocally = true,
  renderOption,
  header,
  footer,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  align = "end",
  width = "w-[220px]",
}: SearchDropdownProps<T>) {
  const [internalSearch, setInternalSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const search = controlledSearch ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;

  const filtered = filterLocally
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  // Click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, containerRef, onClose]);

  // Focus search input when opened, reset on close
  useEffect(() => {
    if (open) {
      searchInputRef.current?.focus();
      setHighlightIndex(-1);
    } else {
      setSearch("");
    }
  }, [open, setSearch]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-option-index]");
    items[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            onSelect(filtered[highlightIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [highlightIndex, filtered, onSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 mt-2 rounded-lg border border-gray-200 bg-white shadow-xl",
        width,
        align === "end" ? "right-0" : "left-0",
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Search input */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={searchInputRef}
          type="text"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Header slot */}
      {header}

      {/* Options list */}
      <div ref={listRef} className="max-h-[250px] overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          filtered.map((option, index) => {
            const selected = isSelected(option);
            const isHighlighted = index === highlightIndex;

            return (
              <div
                key={option.value}
                data-option-index={index}
                role="option"
                aria-selected={selected}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isHighlighted && "bg-gray-50",
                  selected && "bg-blue-50 text-blue-700",
                  !isHighlighted && !selected && "hover:bg-gray-50",
                )}
                onClick={() => onSelect(option)}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <div className="flex-1">
                  {renderOption
                    ? renderOption(option, selected)
                    : option.label}
                </div>
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </div>
            );
          })
        )}
      </div>

      {/* Footer slot */}
      {footer}
    </div>
  );
}

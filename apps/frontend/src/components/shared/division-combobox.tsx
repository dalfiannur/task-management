import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { useDivisions } from "@/hooks/use-divisions";
import styles from "./division-combobox.module.css";

interface DivisionComboboxProps {
  value?: string;
  onChange: (divisionId: string | undefined) => void;
  companyId?: string;
}

export function DivisionCombobox({
  value,
  onChange,
  companyId,
}: DivisionComboboxProps) {
  const [open, setOpen] = useState(false);
  const { data: divisions } = useDivisions(companyId);

  const selectedDivision = divisions?.find((d) => d.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={styles.trigger}
          disabled={!companyId}
        >
          {selectedDivision ? (
            <div className={styles.selectedItem}>
              <span>{selectedDivision.name}</span>
            </div>
          ) : (
            <span className={styles.placeholder}>
              {companyId ? "Select division..." : "Select company first"}
            </span>
          )}
          <div className={styles.actions}>
            {value && (
              <X
                className={styles.clearIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                }}
              />
            )}
            <ChevronsUpDown className={styles.chevron} />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={styles.popover}>
        <Command>
          <CommandInput placeholder="Search divisions..." />
          <CommandList>
            <CommandEmpty>No division found.</CommandEmpty>
            <CommandGroup>
              {divisions?.map((division) => (
                <CommandItem
                  key={division.id}
                  value={division.name}
                  onSelect={() => {
                    onChange(division.id === value ? undefined : division.id);
                    setOpen(false);
                  }}
                >
                  {division.name}
                  <Check
                    className={cn(
                      styles.checkIcon,
                      value === division.id
                        ? styles.checkVisible
                        : styles.checkHidden,
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

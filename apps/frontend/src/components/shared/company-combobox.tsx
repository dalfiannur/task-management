import { useState, useEffect } from "react";
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
import { useCompanies } from "@/hooks/use-companies";
import styles from "./company-combobox.module.css";

interface CompanyComboboxProps {
  value?: string;
  onChange: (companyId: string | undefined) => void;
}

export function CompanyCombobox({ value, onChange }: CompanyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: companies } = useCompanies(debouncedSearch || undefined);
  const selectedCompany = companies?.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={styles.trigger}
        >
          {selectedCompany ? (
            <div className={styles.selectedItem}>
              <span>{selectedCompany.name}</span>
            </div>
          ) : (
            <span className={styles.placeholder}>Select company...</span>
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search companies..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No company found.</CommandEmpty>
            <CommandGroup>
              {companies?.map((company) => (
                <CommandItem
                  key={company.id}
                  value={company.id}
                  onSelect={() => {
                    onChange(company.id === value ? undefined : company.id);
                    setOpen(false);
                  }}
                >
                  <div className={styles.itemContent}>
                    <span className={styles.itemName}>{company.name}</span>
                    {company.legalName && company.legalName !== company.name && (
                      <span className={styles.itemLegalName}>
                        {company.legalName}
                      </span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      styles.checkIcon,
                      value === company.id
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

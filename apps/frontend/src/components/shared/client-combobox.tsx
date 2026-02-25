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
import { useSearchClients } from "@/hooks/use-clients";
import styles from "./company-combobox.module.css";

interface ClientComboboxProps {
  value?: string;
  onChange: (clientId: string | undefined) => void;
}

export function ClientCombobox({ value, onChange }: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: clients } = useSearchClients(debouncedSearch || undefined);
  const selectedClient = clients?.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={styles.trigger}
        >
          {selectedClient ? (
            <div className={styles.selectedItem}>
              <span>{selectedClient.name}</span>
            </div>
          ) : (
            <span className={styles.placeholder}>Select client...</span>
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
            placeholder="Search clients..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No client found.</CommandEmpty>
            <CommandGroup>
              {clients?.map((client) => (
                <CommandItem
                  key={client.id}
                  value={client.id}
                  onSelect={() => {
                    onChange(client.id === value ? undefined : client.id);
                    setOpen(false);
                  }}
                >
                  <div className={styles.itemContent}>
                    <span className={styles.itemName}>{client.name}</span>
                    {client.legalName && client.legalName !== client.name && (
                      <span className={styles.itemLegalName}>
                        {client.legalName}
                      </span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      styles.checkIcon,
                      value === client.id
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

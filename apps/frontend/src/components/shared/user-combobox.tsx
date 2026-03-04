import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSearchUsers, useUser } from "@/hooks/use-users";
import styles from "./user-combobox.module.css";

interface UserComboboxProps {
  value?: string;
  onChange: (userId: string | undefined) => void;
}

export function UserCombobox({ value, onChange }: UserComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: users } = useSearchUsers(search);
  const { data: selectedUser } = useUser(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={styles.trigger}
        >
          {selectedUser ? (
            <div className={styles.selectedUser}>
              <Avatar className={styles.avatar}>
                <AvatarImage src={selectedUser.avatarUrl} />
                <AvatarFallback className={styles.avatarFallback}>
                  {getInitials(selectedUser.name)}
                </AvatarFallback>
              </Avatar>
              <span>{selectedUser.name}</span>
            </div>
          ) : (
            <span className={styles.placeholder}>Select user...</span>
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
            placeholder="Search users..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!search ? (
              <CommandEmpty>Type to search...</CommandEmpty>
            ) : (
              <>
                <CommandEmpty>No user found.</CommandEmpty>
                <CommandGroup>
                  {users?.map((user) => (
                    <CommandItem
                      key={user.id}
                      value={user.id}
                      onSelect={() => {
                        onChange(user.id === value ? undefined : user.id);
                        setOpen(false);
                      }}
                    >
                      <Avatar className={styles.listAvatar}>
                        <AvatarImage src={user.avatarUrl} />
                        <AvatarFallback className={styles.listAvatarFallback}>
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      {user.name}
                      <Check
                        className={cn(
                          styles.checkIcon,
                          value === user.id ? styles.checkVisible : styles.checkHidden,
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

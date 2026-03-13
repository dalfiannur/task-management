import { useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, X, UserPlus } from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { useSearchUsers, useUser } from "@/hooks/use-users";

interface AssigneeComboboxProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

function AssigneeChipLabel({ userIds }: { userIds: string[] }) {
  const { data: firstUser } = useUser(userIds[0]);
  if (userIds.length === 1) return <span className="truncate text-xs font-medium">{firstUser?.name ?? "..."}</span>;
  return <span className="truncate text-xs font-medium">{userIds.length} assignees</span>;
}

function SelectedAssigneeItem({ userId, onDeselect }: { userId: string; onDeselect: () => void }) {
  const { data: user } = useUser(userId);
  const name = user?.name ?? "...";
  const initials = getInitials(name);
  return (
    <CommandItem
      value={userId}
      onSelect={onDeselect}
      className="text-xs"
    >
      <Avatar className="size-5 mr-1.5">
        <AvatarImage src={user?.avatarUrl} />
        <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
      </Avatar>
      {name}
      <Check className="ml-auto size-3.5 opacity-100" />
    </CommandItem>
  );
}

export function AssigneeCombobox({ value, onChange }: AssigneeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: searchResults } = useSearchUsers(search);
  const clearingRef = useRef(false);

  const handleToggle = (userId: string) => {
    onChange(
      value.includes(userId)
        ? value.filter((id) => id !== userId)
        : [...value, userId],
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
            "inline-flex items-center gap-1.5 rounded-full h-7 px-3 text-xs font-bold border-0 shadow-none transition-colors cursor-pointer",
            value.length > 0
              ? "bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300"
              : "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400",
          )}
        >
          {value.length > 0 ? (
            <>
              <AssigneeChipLabel userIds={value} />
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
              <UserPlus className="size-3.5" />
              <span className="text-xs font-medium">Assign</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search users..."
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center">
              {search ? "No user found." : "Type to search..."}
            </CommandEmpty>
            <CommandGroup>
              {!search && value.map((id) => (
                <SelectedAssigneeItem
                  key={id}
                  userId={id}
                  onDeselect={() => handleToggle(id)}
                />
              ))}
              {searchResults?.filter((u) => !value.includes(u.id)).map((user) => {
                const initials = getInitials(user.name);
                return (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() => handleToggle(user.id)}
                    className="text-xs"
                  >
                    <Avatar className="size-5 mr-1.5">
                      <AvatarImage src={user.avatarUrl} />
                      <AvatarFallback className="text-[9px]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    {user.name}
                    <Check
                      className={cn(
                        "ml-auto size-3.5",
                        value.includes(user.id) ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
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
                // Close after a tick so onChange settles first
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

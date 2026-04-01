import { useState, useRef, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, X, UserPlus } from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { useSearchUsers, useUser } from "@/hooks/use-users";
import {
  SearchDropdown,
  type SearchDropdownOption,
} from "./search-dropdown";

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
    <div
      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors hover:bg-muted/50"
      onClick={onDeselect}
    >
      <Avatar className="size-5">
        <AvatarImage src={user?.avatarUrl} />
        <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
      </Avatar>
      <span className="flex-1">{name}</span>
      <Check className="size-3.5 opacity-100" />
    </div>
  );
}

interface UserOption extends SearchDropdownOption {
  avatarUrl?: string;
}

export function AssigneeCombobox({ value, onChange }: AssigneeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: searchResults } = useSearchUsers(search);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(
    (userId: string) => {
      onChange(
        value.includes(userId)
          ? value.filter((id) => id !== userId)
          : [...value, userId],
      );
    },
    [value, onChange],
  );

  // Only show unselected search results in the dropdown options
  const dropdownOptions: UserOption[] = (searchResults ?? [])
    .filter((u) => !value.includes(u.id))
    .map((u) => ({ value: u.id, label: u.name, avatarUrl: u.avatarUrl }));

  return (
    <div ref={containerRef} className="relative">
      {/* Pill trigger */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full h-7 px-3 text-xs font-bold border-0 shadow-none transition-colors cursor-pointer",
          value.length > 0
            ? "bg-gray-800/40 text-gray-300"
            : "bg-gray-800/40 text-gray-400",
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

      {/* Dropdown */}
      <SearchDropdown
        open={open}
        onClose={() => setOpen(false)}
        containerRef={containerRef}
        options={dropdownOptions}
        isSelected={() => false}
        onSelect={(o) => handleToggle(o.value)}
        searchValue={search}
        onSearchChange={setSearch}
        filterLocally={false}
        searchPlaceholder="Search users..."
        emptyText={search ? "No user found." : "Type to search..."}
        header={
          !search && value.length > 0 ? (
            <div className="border-b border-border/50 p-1">
              {value.map((id) => (
                <SelectedAssigneeItem
                  key={id}
                  userId={id}
                  onDeselect={() => handleToggle(id)}
                />
              ))}
            </div>
          ) : undefined
        }
        footer={
          value.length > 0 ? (
            <div className="border-t border-border p-1">
              <button
                type="button"
                className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-destructive rounded-md hover:bg-destructive/10 transition-colors cursor-pointer"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                <X className="size-3" />
                Remove all
              </button>
            </div>
          ) : undefined
        }
        renderOption={(option: UserOption) => (
          <div className="flex items-center gap-1.5 text-xs">
            <Avatar className="size-5">
              <AvatarImage src={option.avatarUrl} />
              <AvatarFallback className="text-[9px]">
                {getInitials(option.label)}
              </AvatarFallback>
            </Avatar>
            {option.label}
          </div>
        )}
      />
    </div>
  );
}

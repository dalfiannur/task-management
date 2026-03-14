import { useState, useMemo } from "react";
import { getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSearchUsers, useUser } from "@/hooks/use-users";
import { SearchSelect } from "./search-select";

interface UserComboboxProps {
  value?: string;
  onChange: (userId: string | undefined) => void;
}

interface UserOption {
  id: string;
  name: string;
  avatarUrl?: string;
}

function UserAvatar({ user, size = "sm" }: { user: UserOption; size?: "sm" }) {
  const sizeClass = size === "sm" ? "h-[1.125rem] w-[1.125rem]" : "";
  return (
    <Avatar className={sizeClass}>
      <AvatarImage src={user.avatarUrl} />
      <AvatarFallback className="text-[0.5625rem]">
        {getInitials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function UserCombobox({ value, onChange }: UserComboboxProps) {
  const [search, setSearch] = useState("");
  const { data: users } = useSearchUsers(search);
  const { data: selectedUser } = useUser(value);

  const options = useMemo(() => {
    const searchResults = users ?? [];
    if (!search && selectedUser) {
      const filtered = searchResults.filter((u) => u.id !== selectedUser.id);
      return [selectedUser, ...filtered];
    }
    return searchResults;
  }, [users, selectedUser, search]);

  return (
    <SearchSelect<UserOption>
      options={options}
      value={value}
      onChange={onChange}
      getOptionValue={(u) => u.id}
      getOptionLabel={(u) => u.name}
      searchValue={search}
      onSearchChange={setSearch}
      filterLocally={false}
      variant="pill"
      placeholder="Select user..."
      searchPlaceholder="Search users..."
      emptyText={search ? "No user found." : "Type to search..."}
      renderSelected={(user) => (
        <span className="flex items-center gap-1.5">
          <UserAvatar user={user} />
          <span>{user.name}</span>
        </span>
      )}
      renderOption={(user) => (
        <span className="flex items-center gap-1.5">
          <UserAvatar user={user} />
          <span>{user.name}</span>
        </span>
      )}
    />
  );
}

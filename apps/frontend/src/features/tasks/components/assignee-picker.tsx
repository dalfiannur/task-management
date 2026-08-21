import { Check, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, getInitials } from "@/lib/utils";
import type { AppUser } from "@/features/auth";

/** Multi-select of project members (assignees). Backend re-validates membership. */
export function AssigneePicker({
  memberIds,
  userMap,
  value,
  onChange,
}: {
  memberIds: string[];
  userMap: Record<string, AppUser>;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="justify-start">
          <UserPlus className="mr-1 h-4 w-4" />
          {value.length ? `${value.length} assignee(s)` : "Assign"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        {memberIds.length === 0 ? (
          <p className="p-2 text-sm text-text-muted">No members yet.</p>
        ) : (
          <ul className="max-h-60 space-y-0.5 overflow-y-auto">
            {memberIds.map((id) => {
              const u = userMap[id];
              const name = u?.displayName ?? id;
              const selected = value.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
                  >
                    <Avatar size="sm">
                      {u?.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                      <AvatarFallback>
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-left">{name}</span>
                    <Check
                      className={cn(
                        "h-4 w-4",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Read-only stack of assignee avatars for a task row. */
export function AssigneeAvatars({
  ids,
  userMap,
  max = 3,
}: {
  ids: string[];
  userMap: Record<string, AppUser>;
  max?: number;
}) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <div className="flex -space-x-1">
      {shown.map((id) => {
        const u = userMap[id];
        const name = u?.displayName ?? id;
        return (
          <Avatar key={id} className="h-5 w-5 ring-1 ring-surface-raised">
            {u?.avatarUrl && <AvatarImage src={u.avatarUrl} />}
            <AvatarFallback className="text-xs">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {extra > 0 && (
        <span className="text-num flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-xs ring-1 ring-surface-raised">
          +{extra}
        </span>
      )}
    </div>
  );
}

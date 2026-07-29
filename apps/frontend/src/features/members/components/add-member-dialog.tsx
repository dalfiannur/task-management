import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/lib/utils";
import { useUserDirectory } from "@/features/users";
import { useAddMember } from "../api/hooks";

/** Add a project member from the active-user directory (existing members hidden). */
export function AddMemberDialog({
  projectId,
  memberIds,
}: {
  projectId: string;
  memberIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { users } = useUserDirectory(q);
  const add = useAddMember();

  const existing = new Set(memberIds);
  const candidates = users.filter((u) => !existing.has(u.id));

  function addMember(userId: string) {
    add.mutate(
      { projectId, userId },
      {
        onSuccess: () => {
          toast.success("Member added.");
          setOpen(false);
          setQ("");
        },
        onError: (err) => toast.error(err.message || "Failed to add member"),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Search active users by name or phone.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search users…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {candidates.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">
              No matching users.
            </li>
          ) : (
            candidates.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => addMember(u.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  <Avatar className="h-8 w-8">
                    {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                    <AvatarFallback>{getInitials(u.displayName)}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1">
                    <span className="block text-sm">{u.displayName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {u.phone}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

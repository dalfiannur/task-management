import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserDirectory } from "@/features/users";
import { useTransferOwnership } from "../api/hooks";

export function TransferOwnershipDialog({
  projectId,
  currentOwnerId,
  open,
  onOpenChange,
}: {
  projectId: string;
  currentOwnerId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { users } = useUserDirectory();
  const transfer = useTransferOwnership();
  const [newOwnerId, setNewOwnerId] = useState("");

  const candidates = users.filter((u) => u.id !== currentOwnerId);

  function onConfirm() {
    if (!newOwnerId) return;
    transfer.mutate(
      { id: projectId, newOwnerId },
      {
        onSuccess: () => {
          toast.success("Ownership transferred.");
          onOpenChange(false);
          setNewOwnerId("");
        },
        onError: (err) => toast.error(err.message || "Transfer failed"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            The new owner gains full authority over this project.
          </DialogDescription>
        </DialogHeader>
        <Select value={newOwnerId} onValueChange={setNewOwnerId}>
          <SelectTrigger>
            <SelectValue placeholder="Select new owner" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.displayName} · {u.phone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            onClick={onConfirm}
            disabled={!newOwnerId || transfer.isPending}
          >
            {transfer.isPending ? "Transferring…" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

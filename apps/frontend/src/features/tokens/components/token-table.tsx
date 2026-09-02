// One row per token. The plaintext is never present here — only `preview`,
// the last 4 characters, which is enough to tell rows apart.

import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { useRevokeToken, useTokens } from "../api/hooks";
import type { AccessToken } from "../types";
import { CreateTokenDialog } from "./create-token-dialog";

function when(iso: string | null, fallback: string) {
  return iso ? new Date(iso).toLocaleDateString() : fallback;
}

/** One row's own revoke confirmation. A per-row `AlertDialog` (rather than one
 *  dialog shared across the table, keyed by "which row is pending") matches
 *  the confirm pattern used elsewhere in this app (see `ManageUsersPage`'s
 *  `UserRow`) and needs no extra state to track which token is targeted. */
function RevokeTokenAction({ token }: { token: AccessToken }) {
  const revoke = useRevokeToken();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{token.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Any AI client using this token loses access immediately. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={revoke.isPending}
            onClick={() =>
              revoke.mutate(
                { id: token.id },
                {
                  onSuccess: () => toast.success(`“${token.name}” revoked.`),
                  onError: (e) => toast.error(e.message || "Failed to revoke token"),
                },
              )
            }
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TokenTable() {
  const { tokens, isLoading, isError, error } = useTokens();

  if (isLoading) {
    return (
      // Sized to the table's eventual shape: a header-height skeleton plus a
      // few row-height ones, inside the same raised card the real table gets.
      <div
        className="space-y-2 overflow-hidden rounded-xl bg-surface-raised p-3 shadow-2"
        aria-busy="true"
        aria-label="Loading tokens"
      >
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-danger">
        {error?.message ?? "Failed to load tokens."}
      </p>
    );
  }

  if (tokens.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No tokens yet"
        body="A personal access token lets an AI client — Claude Desktop, Claude Code, ChatGPT — act as you in the portal."
        actionSlot={<CreateTokenDialog />}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                {t.name}
                {t.expired && (
                  <Badge variant="secondary" className="ml-2">
                    Expired
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-text-muted">
                …{t.preview}
              </TableCell>
              <TableCell>{when(t.createdAt, "—")}</TableCell>
              <TableCell>{when(t.expiresAt, "Never expires")}</TableCell>
              <TableCell>{when(t.lastUsedAt, "Never")}</TableCell>
              <TableCell>
                <RevokeTokenAction token={t} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

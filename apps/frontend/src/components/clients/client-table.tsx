import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Building2, Pencil, Trash2 } from "lucide-react";
import type { Client } from "@/types/client";
import { useDeleteClient } from "@/hooks/use-clients";
import styles from "./client-table.module.css";

interface ClientTableProps {
  clients: Client[];
  isLoading: boolean;
  onEdit: (client: Client) => void;
}

function formatLocation(client: Client): string {
  const parts = [client.city, client.country].filter(Boolean);
  return parts.join(", ");
}

export function ClientTable({ clients, isLoading, onEdit }: ClientTableProps) {
  const deleteClient = useDeleteClient();

  if (isLoading) {
    return (
      <div className={styles.loadingList}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={styles.skeletonRow} />
        ))}
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Building2 className={styles.emptyIcon} />
        <p className={styles.emptyTitle}>No clients found</p>
        <p className={styles.emptySubtitle}>
          Create a client to get started
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className={styles.locationCol}>Location</TableHead>
            <TableHead className={styles.statusCol}>Status</TableHead>
            <TableHead className={styles.actionsCol}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow key={client.id}>
              <TableCell>
                <div className={styles.nameCell}>
                  <span className={styles.clientName}>{client.name}</span>
                  {client.legalName && client.legalName !== client.name && (
                    <span className={styles.legalName}>
                      {client.legalName}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className={styles.locationText}>
                {formatLocation(client) || <span className={styles.noValue}>&mdash;</span>}
              </TableCell>
              <TableCell>
                <Badge
                  variant={client.status === "active" ? "default" : "secondary"}
                  className={styles.statusBadge}
                >
                  {client.status}
                </Badge>
              </TableCell>
              <TableCell className={styles.actionsCell}>
                <div className={styles.actionsWrapper}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={styles.actionBtn}
                    onClick={() => onEdit(client)}
                  >
                    <Pencil className={styles.actionIcon} />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={styles.deleteBtn}
                      >
                        <Trash2 className={styles.actionIcon} />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete client?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete &quot;{client.name}&quot;.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteClient.mutate(client.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useClients } from "@/hooks/use-clients";
import { ClientTable } from "@/components/clients/client-table";
import { ClientForm } from "@/components/clients/client-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client, ClientStatus } from "@/types/client";
import styles from "./clients.module.css";

type ClientFilter = "active" | "inactive" | "all";

export function Component() {
  const [filter, setFilter] = useState<ClientFilter>("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | undefined>();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const statusFilter: ClientStatus | undefined =
    filter === "all" ? undefined : filter;

  const { data: clients, isLoading } = useClients({
    status: statusFilter,
    search: debouncedSearch || undefined,
  });

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormOpen(true);
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) setEditingClient(undefined);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Clients</h1>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className={styles.btnIcon} />
          New Client
        </Button>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className={styles.searchInput}
          />
        </div>
      </div>
      <div className={styles.filterTabs}>
        <button
          className={cn(styles.filterTab, filter === "active" && styles.filterTabActive)}
          onClick={() => setFilter("active")}
        >
          Active
        </button>
        <button
          className={cn(styles.filterTab, filter === "inactive" && styles.filterTabActive)}
          onClick={() => setFilter("inactive")}
        >
          Inactive
        </button>
        <button
          className={cn(styles.filterTab, filter === "all" && styles.filterTabActive)}
          onClick={() => setFilter("all")}
        >
          All
        </button>
      </div>
      <ClientTable
        clients={clients ?? []}
        isLoading={isLoading}
        onEdit={handleEdit}
      />
      <ClientForm
        open={formOpen}
        onOpenChange={handleFormClose}
        client={editingClient}
      />
    </div>
  );
}

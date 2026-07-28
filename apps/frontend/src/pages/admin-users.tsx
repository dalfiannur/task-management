import { useState } from "react";
import { toast } from "sonner";
import { useAdminUsers, useUserAdminActions, type AdminUser } from "@/hooks/use-admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Component() {
  const { users, isLoading, refetch } = useAdminUsers();
  const actions = useUserAdminActions();
  const [form, setForm] = useState({ phone: "", displayName: "", password: "" });

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      await refetch();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message.replace(/^.*?: /, ""));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () => actions.createUser({ variables: { input: { ...form, isAdmin: false } } }),
      "User created",
    );
    setForm({ phone: "", displayName: "", password: "" });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Approve, suspend, and manage member accounts.</p>
      </div>

      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-pass">Password</Label>
          <Input id="c-pass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required />
        </div>
        <Button type="submit">Add user</Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Status</th><th className="p-3">Admin</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: AdminUser) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.displayName}</td>
                  <td className="p-3">{u.phone}</td>
                  <td className="p-3 capitalize">{u.status}</td>
                  <td className="p-3">{u.isAdmin ? "Yes" : "No"}</td>
                  <td className="flex flex-wrap gap-2 p-3">
                    {u.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => run(() => actions.activateUser({ variables: { input: { id: u.id } } }), "Activated")}>Approve</Button>
                    )}
                    {u.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => run(() => actions.suspendUser({ variables: { input: { id: u.id } } }), "Suspended")}>Suspend</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => run(() => actions.setAdmin({ variables: { input: { id: u.id, isAdmin: !u.isAdmin } } }), "Updated")}>{u.isAdmin ? "Revoke admin" : "Make admin"}</Button>
                    <Button size="sm" variant="destructive" onClick={() => run(() => actions.deleteUser({ variables: { input: { id: u.id } } }), "Deleted")}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

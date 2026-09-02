import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectPanel } from "./connect-panel";
import { CreateTokenDialog } from "./create-token-dialog";
import { TokenTable } from "./token-table";

export function TokensPage() {
  // Owned here, not inside CreateTokenDialog, so the header button and the
  // empty state's button (rendered by TokenTable only while the list is
  // empty) open the same dialog instance instead of each mounting their own
  // — see create-token-dialog.tsx for why a second instance is unsafe.
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Access tokens</h1>
          <p className="text-sm text-text-muted">
            Personal access tokens for connecting an AI client to your account.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create token</Button>
      </div>
      <ConnectPanel />
      <TokenTable onCreateToken={() => setCreateOpen(true)} />
      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

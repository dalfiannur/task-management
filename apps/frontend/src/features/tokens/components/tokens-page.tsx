import { ConnectPanel } from "./connect-panel";
import { CreateTokenDialog } from "./create-token-dialog";
import { TokenTable } from "./token-table";

export function TokensPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Access tokens</h1>
          <p className="text-sm text-text-muted">
            Personal access tokens for connecting an AI client to your account.
          </p>
        </div>
        <CreateTokenDialog />
      </div>
      <ConnectPanel />
      <TokenTable />
    </div>
  );
}

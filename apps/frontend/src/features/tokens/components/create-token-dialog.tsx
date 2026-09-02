// A two-stage dialog. The second stage exists because the plaintext is sent
// by the server only once: auto-closing the dialog after success would throw
// away the user's only chance to copy it.
//
// Controlled from the parent (`open`/`onOpenChange`) rather than owning a
// `DialogTrigger` itself: the page has two entry points for "Create token"
// (the header button, always mounted, and the empty state's button, mounted
// only while the token list is empty). A self-contained instance per trigger
// used to mean the empty-state instance — and the `created` reveal stage
// living inside it — got unmounted the instant its own successful creation
// made the list non-empty, discarding the plaintext before the user could
// see it. One shared, always-mounted instance can't be pulled out from under
// itself like that.

import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateToken } from "../api/hooks";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "0", label: "Never expires" },
];

/** `navigator.clipboard` is only defined in a secure context (HTTPS, or
 *  localhost) — on a plain-HTTP LAN dev box it's `undefined`, and even where
 *  it exists the browser can still refuse the write. Either way this must
 *  degrade to "tell the user to copy it by hand", never throw. */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatExpiry(expiresAt: string | null) {
  return expiresAt ? `Expires ${new Date(expiresAt).toLocaleDateString()}` : "Never expires";
}

export function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const create = useCreateToken();
  // Bound once per render so the `created` narrowing below holds inside the
  // JSX closures — re-reading `create.created` there wouldn't narrow.
  const created = create.created;

  function reset() {
    setName("");
    setDays("90");
    // Clears `create.created` too, so reopening the dialog always starts on
    // the form stage rather than re-showing a stale plaintext token.
    create.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        // Once the plaintext is showing, Escape / outside-click / the ✕ are
        // the single riskiest interaction in this feature: they're the
        // reflex response to "save this now", and unlike every other
        // dismissal in this app they'd destroy something unrecoverable. The
        // token itself survives (revoking is the only way to invalidate it),
        // but the user's one chance to read it does not. So during the
        // `created` stage the explicit Close button is the only way out;
        // the form stage stays normally dismissible — there's nothing to
        // lose there, and trapping someone in a form they opened by
        // accident would be its own annoyance.
        showCloseButton={!created}
        onEscapeKeyDown={(e) => {
          if (created) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (created) e.preventDefault();
        }}
      >
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>
                Save it now — this token won't be shown again.
              </DialogDescription>
            </DialogHeader>
            {/* Confirms this is the token just requested, not some other
                row — the plaintext alone doesn't say whose it is. */}
            <p className="text-sm text-text-muted">
              {created.token.name} · {formatExpiry(created.token.expiresAt)}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-border bg-surface-sunken p-3 font-mono text-xs text-text">
                {created.plaintext}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy token"
                onClick={async () => {
                  const ok = await copyToClipboard(created.plaintext);
                  if (ok) toast.success("Token copied");
                  else toast.error("Couldn't copy — select the token and copy it manually");
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <DialogFooter>
              {/* Routed through Radix's own close (not a bare onClick calling
                  onOpenChange directly) so this actually fires the Dialog's
                  controlled onOpenChange handler above — and with it the
                  `reset()` that clears the mutation. Skipping that left the
                  just-revoked token's plaintext to reappear, stale, the next
                  time this dialog opened. */}
              <DialogClose asChild>
                <Button>Close</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create access token</DialogTitle>
              <DialogDescription>
                This token gives an AI client access as you.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={name}
                  maxLength={64}
                  placeholder="Work laptop"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expiry">Expiry</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="token-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!name.trim() || create.isPending}
                onClick={() => {
                  create.mutate(
                    { name: name.trim(), expiresInDays: Number(days) },
                    { onError: (e) => toast.error(e.message || "Failed to create token") },
                  );
                }}
              >
                Create
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

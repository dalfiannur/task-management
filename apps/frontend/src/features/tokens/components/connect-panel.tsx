// Without this panel the feature isn't self-serve: the user holds a token but
// doesn't know where to paste it.

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ConnectPanel() {
  // Built from the page's own origin rather than hardcoded — dev (localhost)
  // and production serve this from different hosts.
  const endpoint = `${window.location.origin}/api/tasks-rs/mcp`;
  const snippet = JSON.stringify(
    {
      mcpServers: {
        "sedjiwa-tasks": {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer <your-token>" },
        },
      },
    },
    null,
    2,
  );

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Configuration copied");
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>How to connect</CardTitle>
        <CardDescription>
          Paste this configuration into your AI client, replacing{" "}
          <code className="mx-1 font-mono">&lt;your-token&gt;</code>
          with a token created below. Whoever holds that token can act as you
          in the portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-mono text-xs text-text-muted">{endpoint}</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-md border border-border bg-surface-sunken p-3 text-xs text-text">
            {snippet}
          </pre>
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy configuration"
            onClick={() => void copySnippet()}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HealthService } from "./gen/health_pb";

// Auth interceptor: attaches `Authorization: Bearer <token>` from the auth store.
// The token getter is injected during app bootstrap (wired to the Jotai auth atom
// during the frontend migration); until then it returns null.
let getToken: () => string | null = () => null;
export function setTokenGetter(fn: () => string | null): void {
  getToken = fn;
}

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getToken();
  if (token) req.header.set("Authorization", `Bearer ${token}`);
  return next(req);
};

/// Connect transport → backend-rs (proxied `/api/tasks-rs` → :3010 in dev).
export const transport = createConnectTransport({
  baseUrl: "/api/tasks-rs",
  interceptors: [authInterceptor],
});

export const healthClient = createClient(HealthService, transport);

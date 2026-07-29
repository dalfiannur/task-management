import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { DescService } from "@bufbuild/protobuf";
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

/// Typed Connect client for any generated service descriptor.
/// Features call `client(ProjectService)`, `client(TaskService)`, etc.
export function client<T extends DescService>(service: T) {
  return createClient(service, transport);
}

export const healthClient = client(HealthService);

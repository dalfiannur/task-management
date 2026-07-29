// TanStack QueryClient — shared across the app. connect-query builds its query
// keys from proto method descriptors, so features never hand-write keys; they
// invalidate via `createConnectQueryKey({ schema, transport, cardinality })`.

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // RPCs are cheap and the backend is authoritative; refetch on focus is noisy.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

import { useEffect } from "react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "react-oidc-context";
import { queryClient } from "@/lib/query-client";
import { setAuthToken } from "@/lib/graphql-client";
import { Toaster } from "@/components/ui/sonner";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: {
    queryClient,
    auth: {
      isAuthenticated: false,
      user: null,
      token: null,
    },
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const auth = useAuth();
  const accessToken = auth.user?.access_token ?? null;

  useEffect(() => {
    setAuthToken(accessToken);
  }, [accessToken]);

  const user = auth.user?.profile
    ? {
        id: auth.user.profile.sub ?? "",
        name: (auth.user.profile.name as string) ?? "",
        email: (auth.user.profile.email as string) ?? "",
      }
    : null;

  return (
    <RouterProvider
      router={router}
      context={{
        auth: {
          isAuthenticated: auth.isAuthenticated,
          user,
          token: accessToken,
        },
      }}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <InnerApp />
      <Toaster />
    </QueryClientProvider>
  );
}

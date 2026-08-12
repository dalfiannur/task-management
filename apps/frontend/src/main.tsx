import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { TransportProvider } from "@connectrpc/connect-query";
import { ThemeProvider } from "next-themes";
import { transport } from "./lib/connect";
import { queryClient } from "./lib/query";
// Import for its wiring side effect (Connect interceptor ← session atom).
import "./features/auth/atoms/session";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <TransportProvider transport={transport}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </TransportProvider>
    </ThemeProvider>
  </StrictMode>,
);

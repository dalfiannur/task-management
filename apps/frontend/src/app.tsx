import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { useAuth } from "react-oidc-context";
import { ThemeProvider } from "next-themes";
import { ApolloProvider, client, setAuthToken } from "@/lib/graphql-client";
import { Toaster } from "@/components/ui/sonner";
import { router } from "./router";

function InnerApp() {
  const auth = useAuth();
  const accessToken = auth.user?.access_token ?? null;

  useEffect(() => {
    setAuthToken(accessToken);
  }, [accessToken]);

  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ApolloProvider client={client}>
        <InnerApp />
        <Toaster />
      </ApolloProvider>
    </ThemeProvider>
  );
}

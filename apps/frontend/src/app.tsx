import { RouterProvider } from "react-router";
import { ThemeProvider } from "next-themes";
import { ApolloProvider, client } from "@/lib/graphql-client";
import { Toaster } from "@/components/ui/sonner";
import { router } from "./router";

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ApolloProvider client={client}>
        <RouterProvider router={router} />
        <Toaster />
      </ApolloProvider>
    </ThemeProvider>
  );
}

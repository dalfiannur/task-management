import { createBrowserRouter, Outlet, Navigate } from "react-router";
import { useAuth } from "react-oidc-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Loader2 } from "lucide-react";

function RootLayout() {
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/callback" replace />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, lazy: () => import("./pages/landing") },
      { path: "callback", lazy: () => import("./pages/callback") },
      { path: "logout", lazy: () => import("./pages/logout") },
      {
        Component: AuthenticatedLayout,
        children: [
          { path: "dashboard", lazy: () => import("./pages/dashboard") },
          { path: "settings", lazy: () => import("./pages/settings") },
          { path: "projects", lazy: () => import("./pages/projects") },
          {
            path: "projects/:projectId",
            lazy: () => import("./pages/project-layout"),
            children: [
              { index: true, lazy: () => import("./pages/project-detail") },
              { path: "sub-projects", lazy: () => import("./pages/project-sub-projects") },
              { path: "media", lazy: () => import("./pages/media") },
              { path: "timeline", lazy: () => import("./pages/timeline") },
              { path: "pages", lazy: () => import("./pages/pages-list") },
              {
                path: "pages/:pageId",
                lazy: () => import("./pages/page-editor"),
              },
            ],
          },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);

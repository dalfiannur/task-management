import { createBrowserRouter, Outlet, Navigate, useLocation } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { AppLayout } from "@/components/layout/app-layout";

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
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function AdminOnly() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "login", lazy: () => import("./pages/login") },
      { path: "register", lazy: () => import("./pages/register") },
      { path: "logout", lazy: () => import("./pages/logout") },
      {
        Component: AuthenticatedLayout,
        children: [
          { path: "dashboard", lazy: () => import("./pages/dashboard") },
          { path: "my-tasks", lazy: () => import("./pages/my-tasks") },
          { path: "tasks-by-me", lazy: () => import("./pages/tasks-by-me") },
          { path: "settings", lazy: () => import("./pages/settings") },
          { path: "projects", lazy: () => import("./pages/projects") },
          {
            Component: AdminOnly,
            children: [
              { path: "admin/users", lazy: () => import("./pages/admin-users") },
            ],
          },
          {
            path: "projects/:projectId",
            lazy: () => import("./pages/project-layout"),
            children: [
              { index: true, element: <Navigate to="all-tasks" replace /> },
              { path: "all-tasks", lazy: () => import("./pages/project-detail") },
              { path: "sub-projects", lazy: () => import("./pages/project-sub-projects") },
              { path: "members", lazy: () => import("./pages/project-members") },
              { path: "media", lazy: () => import("./pages/media") },
              { path: "timeline", lazy: () => import("./pages/timeline") },
              { path: "pages", lazy: () => import("./pages/pages-list") },
              { path: "pages/:pageId", lazy: () => import("./pages/page-editor") },
            ],
          },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);

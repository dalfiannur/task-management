import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

// Keep in sync with DEFAULT_APP_NAME in src/lib/app-config.ts (the <title> is
// plain HTML and can't import that module).
const DEFAULT_APP_NAME = "Sedjiwa · Tasks";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const appName = env.VITE_APP_NAME?.trim() || DEFAULT_APP_NAME;

  return {
    plugins: [
      // Must precede the React plugin: generates src/routeTree.gen.ts from routes/.
      TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
      tailwindcss(),
      react(),
      // Fill the document <title> from VITE_APP_NAME (with a default).
      {
        name: "html-app-name",
        transformIndexHtml: (html: string) =>
          html.replace(/__APP_NAME__/g, appName),
      },
    ],
    base: "/",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3001,
      allowedHosts: true,
      proxy: {
        "/api/tasks/": {
          target: env.VITE_API_BASE_URL ?? "http://localhost:3000",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/tasks/, ""),
        },
        // backend-rs (Rust + Connect) during transition — leaves /api/tasks (Bun) untouched.
        "/api/tasks-rs/": {
          target: env.VITE_TASKS_RS_BASE_URL ?? "http://localhost:3010",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/tasks-rs/, ""),
        },
        "/api/core/": {
          target: env.VITE_CORE_API_BASE_URL ?? "http://localhost:3101",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/core/, ""),
        },
        "/api/media/": {
          target: env.VITE_MEDIA_API_BASE_URL ?? "http://localhost:3103",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/media/, ""),
        },
        "/api/sales/": {
          target: env.VITE_SALES_API_BASE_URL ?? "http://localhost:3102",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/sales/, ""),
        },
      },
    },
  };
});

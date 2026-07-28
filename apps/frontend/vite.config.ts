import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");

  return {
    plugins: [
      tailwindcss(),
      react(),
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

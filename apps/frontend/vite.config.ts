import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
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
      "/api-tasks/": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/api-core/": {
        target: process.env.VITE_CORE_API_BASE_URL ?? "http://localhost:3200",
        changeOrigin: true,
      },
      "/api-oidc/": {
        target: process.env.VITE_OIDC_API_BASE_URL ?? "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});

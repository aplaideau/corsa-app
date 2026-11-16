import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In dev (`npm run dev`), API calls are forwarded to the Node server (port 8080).
const API = process.env.API_URL || "http://localhost:8080";
const proxied = ["/api", "/get_vehicleinfo", "/charge_control", "/charge_now", "/preconditioning",
  "/wakeup", "/lock_door"];

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { proxy: Object.fromEntries(proxied.map((p) => [p, API])) },
});

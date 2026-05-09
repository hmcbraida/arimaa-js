import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite configuration for the React demo application.
 *
 * The app is intentionally thin: it mounts the component tree that talks to the
 * shared Arimaa game engine.
 *
 * When `API_URL` is set in the environment, all `/api` requests (including
 * WebSocket upgrades) are proxied to that URL. This lets `bun run dev:docker`
 * point the Vite dev server at the API served by docker compose while still
 * getting HMR for front-end code.
 */
export default defineConfig({
  plugins: [react()],
  server: process.env.API_URL
    ? {
        proxy: {
          "/api": {
            target: process.env.API_URL,
            // Proxy WebSocket upgrades for the /api/ws event stream.
            ws: true,
          },
        },
      }
    : undefined,
});

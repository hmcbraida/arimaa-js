import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite configuration for the React demo application.
 *
 * The app is intentionally thin: it mounts the component tree that talks to the
 * shared Arimaa game engine.
 */
export default defineConfig({
  plugins: [react()],
  base: "/arimaatic/",
});

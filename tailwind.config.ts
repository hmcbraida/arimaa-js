import type { Config } from "tailwindcss";

/**
 * Tailwind scans only application and component sources.
 *
 * All visual styling for the app is kept in `src/components` except the global
 * Tailwind directives in `src/index.css`.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;

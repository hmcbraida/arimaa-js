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
    extend: {
      fontFamily: {
        sans: ["Barlow", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Tokyo Night colour palette — only colours actively used as Tailwind classes
        tn: {
          bg: "#1a1b2e",
          surface: "#1f2335",
          panel: "#24283b",
          overlay: "#292e42",
          border: "#3b4261",
          fg: "#c0caf5",
          "fg-muted": "#a9b1d6",
          comment: "#565f89",
          blue: "#7aa2f7",
          green: "#9ece6a",
          yellow: "#e0af68",
          red: "#f7768e",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

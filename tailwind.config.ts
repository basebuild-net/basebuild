import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bb: {
          bg: "var(--bb-bg)",
          panel: "var(--bb-panel)",
          panel2: "var(--bb-panel-2)",
          border: "var(--bb-border)",
          text: "var(--bb-text)",
          muted: "var(--bb-muted)",
          accent: "var(--bb-accent)",
          danger: "var(--bb-danger)",
          success: "var(--bb-success)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1E2A38",
        "ink-soft": "#55606B",
        "ink-faint": "#8992A0",
        paper: "#F7F5F1",
        surface: "#FFFFFF",
        "surface-2": "#F1EFE9",
        line: "#E4E1D8",
        "line-strong": "#D4D0C4",
        // Confident navy — the primary color, used as solid fills (buttons,
        // active states), not just as a thin accent line.
        blueprint: "#1E3A5F",
        "blueprint-soft": "#E7EDF5",
        // Semantic status colors, each with a saturated text + soft
        // background pair (the "colorful badge" language) instead of
        // every status reading as the same gray pill.
        success: "#15803D",
        "success-soft": "#E4F5EA",
        warning: "#B45309",
        "warning-soft": "#FDF1DD",
        redline: "#B5432B",
        "redline-soft": "#FAE8E2",
        violet: "#7C3AED",
        "violet-soft": "#F1EAFC",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;

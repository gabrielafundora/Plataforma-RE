import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Same "blueprint" palette used in the strategy docs' artifacts,
        // carried into the actual product for visual continuity.
        ink: "#1E2A38",
        "ink-soft": "#55606B",
        "ink-faint": "#8992A0",
        paper: "#F3F2EE",
        surface: "#FFFFFF",
        "surface-2": "#EBEAE4",
        line: "#D7D3C9",
        "line-strong": "#BEBAAF",
        blueprint: "#1F5FA8",
        "blueprint-soft": "#E7EEF6",
        redline: "#B5432B",
        "redline-soft": "#F5E7E2",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

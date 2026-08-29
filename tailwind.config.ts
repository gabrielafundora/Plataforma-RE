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
        paper: "#F3F2EE",
        line: "#D7D3C9",
        blueprint: "#1F5FA8",
        redline: "#B5432B",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

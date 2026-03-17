/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'Geist Mono'", "ui-monospace", "monospace"],
        sans: ["'Geist'", "ui-sans-serif", "system-ui"],
      },
      colors: {
        void: "#080a0e",
        surface: "#0d1017",
        panel: "#121820",
        border: "#1e2635",
        muted: "#2a3445",
        subtle: "#4a5568",
        ghost: "#6b7280",
        dim: "#94a3b8",
        text: "#e2e8f0",
        bright: "#f8fafc",
        guard: {
          DEFAULT: "#00d4aa",
          dim: "#00a080",
          glow: "rgba(0,212,170,0.15)",
        },
        ember: {
          DEFAULT: "#ff6b35",
          dim: "#cc4f20",
          glow: "rgba(255,107,53,0.15)",
        },
        amber: {
          DEFAULT: "#f5a623",
          dim: "#c07d10",
          glow: "rgba(245,166,35,0.15)",
        },
        rose: {
          DEFAULT: "#ff4466",
          dim: "#cc2244",
          glow: "rgba(255,68,102,0.15)",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "scan": "scan 4s linear infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "grid": "linear-gradient(rgba(30,38,53,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(30,38,53,0.4) 1px, transparent 1px)",
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      backgroundSize: {
        "grid": "40px 40px",
      },
    },
  },
  plugins: [],
};

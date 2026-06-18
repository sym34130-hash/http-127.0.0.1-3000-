import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        field: "#f6f8fb",
        line: "#d9e1ec",
        muted: "#66738a",
        success: "#1f9d6b",
        warning: "#d88522",
        danger: "#d94848",
        done: "#2f6fbd"
      },
      boxShadow: {
        toolbar: "0 1px 2px rgba(23, 32, 51, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

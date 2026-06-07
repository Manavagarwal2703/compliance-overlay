/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        abb: {
          primary: "#D71920",
          dark: "#0f172a", // slate-900 equivalent for a richer dark mode
          surface: "#f8f9fc",
        },
      },
    },
  },
  plugins: [],
};

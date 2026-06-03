/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        abb: {
          primary: "#FF000F",
          dark: "#1a1a2e",
          surface: "#f8f9fc",
        },
      },
    },
  },
  plugins: [],
};

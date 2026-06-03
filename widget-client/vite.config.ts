import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ command }) => {
  const shared = {
    plugins: [react()],
  };

  if (command === "serve") {
    return shared;
  }

  return {
    ...shared,
    build: {
      lib: {
        entry: resolve(__dirname, "src/mount.tsx"),
        name: "ComplianceChatWidget",
        fileName: "compliance-chat-widget",
        formats: ["es", "iife"],
      },
      rollupOptions: {
        output: {
          assetFileNames: "compliance-chat-widget.[ext]",
        },
      },
      cssCodeSplit: false,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  };
});

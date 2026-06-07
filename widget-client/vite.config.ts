import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ command, mode }) => {
  // Load .env / .env.production variables so they are available at build time.
  // VITE_GATEWAY_URL must be set to the intranet IP of the gateway server
  // before running `npm run build` for a production deployment.
  const env = loadEnv(mode, process.cwd(), "VITE_");

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
      // Bake the gateway base URL into the bundle at build time.
      // Set VITE_GATEWAY_URL=http://<GATEWAY_HOST_IP>:3000 in .env.production.
      "import.meta.env.VITE_GATEWAY_URL": JSON.stringify(
        env.VITE_GATEWAY_URL ?? ""
      ),
    },
  };
});

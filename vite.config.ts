import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative assets support both /Pocket_Sense/ on Pages and a root-domain host.
  base: "./",
  plugins: [react()],
  build: { target: "es2022" },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

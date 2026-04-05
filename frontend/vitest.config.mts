import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.tsx",
      "scripts/**/*.spec.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/._*",
      "**/.DS_Store",
    ],
  },
});

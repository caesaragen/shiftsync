import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": `${__dirname}/src` },
  },
  test: {
    // Default environment stays "node" so logic/unit tests (src/**/*.test.ts)
    // remain fast. `environmentMatchGlobs` is not available in this Vitest
    // version (removed from the config type in v5, superseded by
    // `test.projects`) — component tests opt into jsdom individually via a
    // `// @vitest-environment jsdom` docblock at the top of the file instead.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    server: { deps: { inline: [/next-auth/, /^next\//] } },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works on GitHub Pages under any repository name.
  base: "./",
  test: {
    environment: "jsdom",
  },
});

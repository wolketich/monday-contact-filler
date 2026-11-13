import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "extension.spec.mjs",
  workers: 1,
  reporter: "list",
  timeout: 30000
});

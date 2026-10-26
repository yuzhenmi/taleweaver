import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../workspace-aliases";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});

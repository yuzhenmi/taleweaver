import { defineConfig } from "vite";
import { workspaceAliases } from "../../workspace-aliases";

export default defineConfig({ resolve: { alias: workspaceAliases } });

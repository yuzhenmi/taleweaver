import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { workspaceAliases } from "../../workspace-aliases";

export default defineConfig({
  base: "/taleweaver/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: [...workspaceAliases, { find: "@", replacement: path.resolve(__dirname, "./src") }] },
});

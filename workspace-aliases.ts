// Resolve `@taleweaver/*` to package SOURCE inside this monorepo (vite/vitest), mirroring the
// `@taleweaver/source` export condition tsc uses. Published `exports` point at built `dist/`.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const packagesDir = new URL("./packages/", import.meta.url);

export const workspaceAliases = fs
  .readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(new URL(`${d.name}/src/index.ts`, packagesDir)))
  .map((d) => ({
    find: new RegExp(`^@taleweaver/${d.name}$`),
    replacement: fileURLToPath(new URL(`${d.name}/src/index.ts`, packagesDir)),
  }));

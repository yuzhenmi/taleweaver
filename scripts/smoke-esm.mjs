// Import every publishable package's BUILT entry under plain Node ESM (no source condition),
// the way an external consumer resolves it. Fails if dist is missing or not valid Node ESM.
import fs from "node:fs";

const pkgs = fs.readdirSync(new URL("../packages", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
let failed = false;
for (const dir of pkgs) {
  const manifest = JSON.parse(fs.readFileSync(new URL(`../packages/${dir}/package.json`, import.meta.url), "utf8"));
  if (manifest.private) continue;
  try {
    const mod = await import(manifest.name);
    if (Object.keys(mod).length === 0) throw new Error("no exports");
    if (!fs.existsSync(new URL(`../packages/${dir}/dist/index.d.ts`, import.meta.url))) throw new Error("no index.d.ts");
    console.log(`ok   ${manifest.name} (${Object.keys(mod).length} exports)`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${manifest.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (failed) process.exit(1);

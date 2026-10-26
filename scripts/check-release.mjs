// Release guard: the pushed tag must equal every publishable package's version, and every
// intra-repo `@taleweaver/*` range must admit that version (lockstep pre-1.0 semver).
import fs from "node:fs";

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (tag === undefined) throw new Error("usage: check-release.mjs v<version>");
const version = tag.replace(/^v/, "");
const dir = new URL("../packages/", import.meta.url);
const errors = [];
for (const d of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const j = JSON.parse(fs.readFileSync(new URL(`${d.name}/package.json`, dir), "utf8"));
  if (!j.private && j.version !== version) errors.push(`${j.name}@${j.version} != ${version}`);
  for (const k of ["dependencies", "peerDependencies", "devDependencies"]) {
    for (const [dep, range] of Object.entries(j[k] ?? {})) {
      if (dep.startsWith("@taleweaver/") && range !== `^${version}`) errors.push(`${j.name} ${k}.${dep} = ${range}, want ^${version}`);
    }
  }
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`release ${version} consistent`);

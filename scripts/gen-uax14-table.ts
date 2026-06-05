// Codegen for the UAX #14 Line_Break property table. Dev tooling — run via
// `npm run gen:uax14`. Reads the vendored UCD data and emits a committed,
// compact range table. Node 24 runs this .ts file directly.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../packages/core/src/layout/uax14/data");
// Output path: the committed table by default; overridable via env so the
// regeneration-drift test can generate to a temp file WITHOUT mutating the
// committed source (see line-break-table.test.ts).
const outFile = process.env.UAX14_OUT ??
  join(here, "../packages/core/src/layout/uax14/line-break-table.ts");

const UNICODE_VERSION = "16.0.0";

/** Parse a UCD property file into per-code-point assignments. Lines look like
 *  `AC00..D7A3;ID # comment` or `00A0;GL # comment`. Returns Map<cp, value>. */
function parseUcd(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (line === "") continue;
    const [rangePart, value] = line.split(";").map(s => s.trim());
    if (value === undefined || value === "") continue;
    const m = rangePart.match(/^([0-9A-Fa-f]+)(?:\.\.([0-9A-Fa-f]+))?$/);
    if (!m) continue;
    const lo = parseInt(m[1], 16);
    const hi = m[2] !== undefined ? parseInt(m[2], 16) : lo;
    for (let cp = lo; cp <= hi; cp++) map.set(cp, value);
  }
  return map;
}

const lineBreak = parseUcd(readFileSync(join(dataDir, "LineBreak.txt"), "utf8"));
const generalCat = parseUcd(readFileSync(join(dataDir, "DerivedGeneralCategory.txt"), "utf8"));
const eastAsian = parseUcd(readFileSync(join(dataDir, "EastAsianWidth.txt"), "utf8"));
const emojiData = parseUcd(readFileSync(join(dataDir, "emoji-data.txt"), "utf8"));

// Bake SA → CM (if Mn/Mc) else AL. All other classes pass through verbatim.
function resolveClass(cp: number, cls: string): string {
  if (cls !== "SA") return cls;
  const gc = generalCat.get(cp);
  return gc === "Mn" || gc === "Mc" ? "CM" : "AL";
}

// Default Line_Break value for unassigned code points is per UAX #44 / the
// @missing line in LineBreak.txt. We emit ONLY assigned ranges; the runtime
// returns XX (→AL) for any code point not covered by a range.
const ranges: { lo: number; hi: number; cls: string }[] = [];
const sorted = [...lineBreak.keys()].sort((a, b) => a - b);
for (const cp of sorted) {
  const cls = resolveClass(cp, lineBreak.get(cp) as string);
  const last = ranges[ranges.length - 1];
  if (last && last.hi === cp - 1 && last.cls === cls) {
    last.hi = cp; // coalesce adjacent same-class
  } else {
    ranges.push({ lo: cp, hi: cp, cls });
  }
}

// Stable, sorted class-id assignment (alphabetical) for determinism.
const classNames = [...new Set(ranges.map(r => r.cls))].sort();
const classId = new Map(classNames.map((n, i) => [n, i]));

const flat: number[] = [];
for (const r of ranges) flat.push(r.lo, r.hi, classId.get(r.cls) as number);

// East-Asian-wide ranges (ea ∈ {F, W, H}) for LB30's OP/CP exclusion. Emit a
// flat sorted [lo, hi] pair array (no class — membership is boolean).
const eaRanges: { lo: number; hi: number }[] = [];
for (const cp of [...eastAsian.keys()].sort((a, b) => a - b)) {
  const w = eastAsian.get(cp);
  if (w !== "F" && w !== "W" && w !== "H") continue;
  const last = eaRanges[eaRanges.length - 1];
  if (last && last.hi === cp - 1) last.hi = cp;
  else eaRanges.push({ lo: cp, hi: cp });
}
const eaFlat: number[] = [];
for (const r of eaRanges) eaFlat.push(r.lo, r.hi);

// LB30b 2nd clause: `[\p{Extended_Pictographic} & \p{gc=Cn}] × EM`. We pre-
// intersect Extended_Pictographic (from emoji-data.txt) with General_Category=Cn.
// A code point is gc=Cn if DerivedGeneralCategory.txt lists it as "Cn" OR does
// not list it at all (the @missing default for unassigned code points is Cn).
const epCnRanges: { lo: number; hi: number }[] = [];
for (const cp of [...emojiData.keys()].sort((a, b) => a - b)) {
  if (emojiData.get(cp) !== "Extended_Pictographic") continue;
  const gc = generalCat.get(cp);
  if (gc !== undefined && gc !== "Cn") continue; // assigned non-Cn → excluded
  const last = epCnRanges[epCnRanges.length - 1];
  if (last && last.hi === cp - 1) last.hi = cp;
  else epCnRanges.push({ lo: cp, hi: cp });
}
const epCnFlat: number[] = [];
for (const r of epCnRanges) epCnFlat.push(r.lo, r.hi);

// LB15a/LB15b pin opening/closing quotes: they need, for a QU-classed code
// point, whether its General_Category is Pi (initial quote) or Pf (final quote).
// Pre-intersect LineBreak=QU with gc=Pi / gc=Pf (mirrors the SA / Extended_-
// Pictographic GC baking) so the runtime carries no General_Category table.
function quGcRanges(gcWanted: string): { lo: number; hi: number }[] {
  const rs: { lo: number; hi: number }[] = [];
  for (const cp of sorted) {
    if (lineBreak.get(cp) !== "QU") continue;
    if (generalCat.get(cp) !== gcWanted) continue;
    const last = rs[rs.length - 1];
    if (last && last.hi === cp - 1) last.hi = cp;
    else rs.push({ lo: cp, hi: cp });
  }
  return rs;
}
const piQuRanges = quGcRanges("Pi");
const pfQuRanges = quGcRanges("Pf");
const piQuFlat: number[] = [];
for (const r of piQuRanges) piQuFlat.push(r.lo, r.hi);
const pfQuFlat: number[] = [];
for (const r of pfQuRanges) pfQuFlat.push(r.lo, r.hi);

const out = `// GENERATED by scripts/gen-uax14-table.ts from Unicode ${UNICODE_VERSION}
// LineBreak.txt (SA baked to CM/AL via DerivedGeneralCategory.txt) +
// EastAsianWidth.txt (ea F/W/H ranges for LB30) + emoji-data.txt
// (Extended_Pictographic ∩ gc=Cn for LB30b). DO NOT EDIT BY HAND — run
// \`npm run gen:uax14\` to regenerate. See data/README.md.
/* eslint-disable */
export const UAX14_UNICODE_VERSION = "${UNICODE_VERSION}";

/** Class names indexed by class id (the third value in each table triple). */
export const LINE_BREAK_CLASS_NAMES: readonly string[] = ${JSON.stringify(classNames)};

/** Flat sorted [lo, hi, classId] triples; binary-searchable by code point. */
export const LINE_BREAK_RANGES: readonly number[] = [
${chunk(flat, 12).map(row => "  " + row.join(", ") + ",").join("\n")}
];

/** Flat sorted [lo, hi] pairs of East-Asian-wide (ea∈F/W/H) code points (LB30). */
export const EAST_ASIAN_WIDE_RANGES: readonly number[] = [
${chunk(eaFlat, 12).map(row => "  " + row.join(", ") + ",").join("\n")}
];

/** Flat sorted [lo, hi] pairs of code points that are BOTH
 *  Extended_Pictographic AND General_Category=Cn (unassigned) — the LB30b 2nd
 *  clause left operand: \`[\\p{Extended_Pictographic} & \\p{gc=Cn}] × EM\`. */
export const EXTENDED_PICTOGRAPHIC_CN_RANGES: readonly number[] = [
${chunk(epCnFlat, 12).map(row => "  " + row.join(", ") + ",").join("\n")}
];

/** Flat sorted [lo, hi] pairs of QU code points with gc=Pi (initial quote) — LB15a. */
export const PI_QU_RANGES: readonly number[] = [
${chunk(piQuFlat, 12).map(row => "  " + row.join(", ") + ",").join("\n")}
];

/** Flat sorted [lo, hi] pairs of QU code points with gc=Pf (final quote) — LB15b. */
export const PF_QU_RANGES: readonly number[] = [
${chunk(pfQuFlat, 12).map(row => "  " + row.join(", ") + ",").join("\n")}
];
`;

function chunk<T>(arr: T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += n) rows.push(arr.slice(i, i + n));
  return rows;
}

writeFileSync(outFile, out, "utf8");
console.log(`Wrote ${ranges.length} LB ranges (${classNames.length} classes) + ${eaRanges.length} EA-wide ranges + ${epCnRanges.length} ExtPict∩Cn ranges + ${piQuRanges.length} Pi-QU + ${pfQuRanges.length} Pf-QU ranges to ${outFile}`);

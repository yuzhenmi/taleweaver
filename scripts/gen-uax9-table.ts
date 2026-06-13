// Codegen for the UAX #9 Bidi_Class property table. Dev tooling — run via
// `npm run gen:uax9`. Reads the vendored UCD data and emits a committed,
// compact range table. Node 24 runs this .ts file directly.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const uax9Dir = join(here, "../packages/core/src/layout/uax9");
const dataDir = join(uax9Dir, "data");
// Output DIRECTORY: the committed uax9 source dir by default; overridable via env
// so the regeneration-drift test can generate to a temp dir WITHOUT mutating the
// committed sources (see bidi-class-table.test.ts). All three generated tables
// (bidi-class-table.ts, bidi-mirror-table.ts, bidi-bracket-table.ts) are written
// into this directory.
const outDir = process.env.UAX9_OUT ?? uax9Dir;

const UNICODE_VERSION = "16.0.0";

// DerivedBidiClass.txt uses the long Bidi_Class value aliases on its `@missing`
// lines (e.g. `Right_To_Left`) but the short aliases on its explicit assignment
// lines (e.g. `R`). Normalize both to the short alias used by the runtime type.
const LONG_TO_SHORT: Record<string, string> = {
  Left_To_Right: "L",
  Right_To_Left: "R",
  Arabic_Letter: "AL",
  European_Number: "EN",
  European_Separator: "ES",
  European_Terminator: "ET",
  Arabic_Number: "AN",
  Common_Separator: "CS",
  Nonspacing_Mark: "NSM",
  Boundary_Neutral: "BN",
  Paragraph_Separator: "B",
  Segment_Separator: "S",
  White_Space: "WS",
  Other_Neutral: "ON",
  Left_To_Right_Embedding: "LRE",
  Right_To_Left_Embedding: "RLE",
  Left_To_Right_Override: "LRO",
  Right_To_Left_Override: "RLO",
  Pop_Directional_Format: "PDF",
  Left_To_Right_Isolate: "LRI",
  Right_To_Left_Isolate: "RLI",
  First_Strong_Isolate: "FSI",
  Pop_Directional_Isolate: "PDI",
};

function toShort(value: string): string {
  return LONG_TO_SHORT[value] ?? value;
}

const text = readFileSync(join(dataDir, "DerivedBidiClass.txt"), "utf8");

// Parse the `@missing` annotations (in comment lines) into the default-bidi base
// layer. Format: `# @missing: 0000..10FFFF; Left_To_Right`. The overall default
// is `L` (0000..10FFFF); block-specific overrides (Hebrew→R, Arabic→AL/AN/ET …)
// follow. These assign defaults to UNASSIGNED code points, which the explicit
// assignment lines (below) then overlay for assigned ones.
//
// NOTE — why this generator is heavier than `gen-uax14-table.ts`: UAX #14 has a
// single global default (`XX`) for unassigned code points, so that generator
// emits ONLY the assigned ranges and lets the runtime return `XX` for gaps. UAX
// #9 instead has *block-specific* RTL/AL/AN/ET defaults for unassigned code
// points (a single fallback can't express them), so here we MATERIALIZE the full
// 0000..10FFFF range from the `@missing` base layer, then overlay the explicit
// assignments. The output is still a coalesced range table; only the build-time
// Map is dense.
interface Range {
  lo: number;
  hi: number;
  cls: string;
}
const missingRanges: Range[] = [];
for (const rawLine of text.split("\n")) {
  const m = rawLine.match(
    /^#\s*@missing:\s*([0-9A-Fa-f]+)\.\.([0-9A-Fa-f]+)\s*;\s*(\S+)/,
  );
  if (!m) continue;
  missingRanges.push({
    lo: parseInt(m[1], 16),
    hi: parseInt(m[2], 16),
    cls: toShort(m[3]),
  });
}

// Build the per-code-point default map from the @missing ranges. Later @missing
// lines override earlier ones for overlapping code points (the file lists the
// 0000..10FFFF overall default first, then narrower block defaults), so apply in
// file order.
const cls = new Map<number, string>();
for (const r of missingRanges) {
  for (let cp = r.lo; cp <= r.hi; cp++) cls.set(cp, r.cls);
}

// Overlay the explicit assignments. Lines look like `0041..005A ; L # ...` or
// `00AA ; L # ...`. Comment-only lines (already consumed for @missing) and blank
// lines are skipped.
for (const rawLine of text.split("\n")) {
  const line = rawLine.split("#")[0].trim();
  if (line === "") continue;
  const [rangePart, value] = line.split(";").map((s) => s.trim());
  if (value === undefined || value === "") continue;
  const m = rangePart.match(/^([0-9A-Fa-f]+)(?:\.\.([0-9A-Fa-f]+))?$/);
  if (!m) continue;
  const lo = parseInt(m[1], 16);
  const hi = m[2] !== undefined ? parseInt(m[2], 16) : lo;
  const short = toShort(value);
  for (let cp = lo; cp <= hi; cp++) cls.set(cp, short);
}

// Coalesce adjacent same-class code points into sorted [lo, hi, classId] ranges.
// Every code point 0..10FFFF is covered (the 0000..10FFFF @missing default
// guarantees it), so the runtime needs no out-of-table fallback class.
const ranges: Range[] = [];
const sorted = [...cls.keys()].sort((a, b) => a - b);
for (const cp of sorted) {
  const c = cls.get(cp) as string;
  const last = ranges[ranges.length - 1];
  if (last && last.hi === cp - 1 && last.cls === c) {
    last.hi = cp; // coalesce adjacent same-class
  } else {
    ranges.push({ lo: cp, hi: cp, cls: c });
  }
}

// Stable, sorted class-id assignment (alphabetical) for determinism.
const classNames = [...new Set(ranges.map((r) => r.cls))].sort();
const classId = new Map(classNames.map((n, i) => [n, i]));

const flat: number[] = [];
for (const r of ranges) flat.push(r.lo, r.hi, classId.get(r.cls) as number);

const out = `// GENERATED by scripts/gen-uax9-table.ts from Unicode ${UNICODE_VERSION}
// DerivedBidiClass.txt (@missing default-bidi ranges as the base layer, explicit
// assignments overlaid). DO NOT EDIT BY HAND — run \`npm run gen:uax9\` to
// regenerate. See data/README.md.
/* eslint-disable */
export const UAX9_UNICODE_VERSION = "${UNICODE_VERSION}";

/** Class names indexed by class id (the third value in each table triple). */
export const BIDI_CLASS_NAMES: readonly string[] = ${JSON.stringify(classNames)};

/** Flat sorted [lo, hi, classId] triples; binary-searchable by code point.
 *  Covers the full 0..10FFFF range (no out-of-table fallback needed). */
export const BIDI_CLASS_RANGES: readonly number[] = [
${chunk(flat, 12).map((row) => "  " + row.join(", ") + ",").join("\n")}
];
`;

function chunk<T>(arr: T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += n) rows.push(arr.slice(i, i + n));
  return rows;
}

const classOut = join(outDir, "bidi-class-table.ts");
writeFileSync(classOut, out, "utf8");
console.log(
  `Wrote ${ranges.length} bidi-class ranges (${classNames.length} classes) to ${classOut}`,
);

// ---------------------------------------------------------------------------
// BidiMirroring.txt → bidi-mirror-table.ts
// ---------------------------------------------------------------------------
// Each data line: `<code>; <mirrored-code> # comment`. We emit a flat sorted
// [codePoint, mirroredCodePoint] pair list (even index = source, odd = target),
// binary-searchable by the source code point. Sorted by source for determinism.
const mirrorText = readFileSync(join(dataDir, "BidiMirroring.txt"), "utf8");
const mirrorMap = new Map<number, number>();
for (const rawLine of mirrorText.split("\n")) {
  const line = rawLine.split("#")[0].trim();
  if (line === "") continue;
  const parts = line.split(";").map((s) => s.trim());
  if (parts.length < 2) continue;
  const src = parseInt(parts[0], 16);
  const dst = parseInt(parts[1], 16);
  if (Number.isNaN(src) || Number.isNaN(dst)) continue;
  mirrorMap.set(src, dst);
}
const mirrorPairs: number[] = [];
for (const src of [...mirrorMap.keys()].sort((a, b) => a - b)) {
  mirrorPairs.push(src, mirrorMap.get(src) as number);
}
const mirrorOut = `// GENERATED by scripts/gen-uax9-table.ts from Unicode ${UNICODE_VERSION}
// BidiMirroring.txt (Bidi_Mirroring_Glyph property). DO NOT EDIT BY HAND —
// run \`npm run gen:uax9\` to regenerate. See data/README.md.
/* eslint-disable */

/** Flat sorted [codePoint, mirroredCodePoint] pairs; binary-searchable by the
 *  source code point (even indices). A code point absent from this list has no
 *  Bidi_Mirroring_Glyph. */
export const BIDI_MIRROR_PAIRS: readonly number[] = [
${chunk(mirrorPairs, 12).map((row) => "  " + row.join(", ") + ",").join("\n")}
];
`;
const mirrorOutFile = join(outDir, "bidi-mirror-table.ts");
writeFileSync(mirrorOutFile, mirrorOut, "utf8");
console.log(
  `Wrote ${mirrorPairs.length / 2} bidi-mirror pairs to ${mirrorOutFile}`,
);

// ---------------------------------------------------------------------------
// BidiBrackets.txt → bidi-bracket-table.ts
// ---------------------------------------------------------------------------
// Each data line: `<code>; <paired-code>; <o|c|n> # comment`. We emit a flat
// sorted [codePoint, pairedCodePoint, kindId] triple list, binary-searchable by
// the source code point. kindId: 0 = open (o), 1 = close (c). Lines with type
// `n` (None) are skipped (they never appear in this file's listed set, which is
// only Open/Close, but we guard anyway).
//
// CANONICAL EQUIVALENCE (BD16): U+2329/U+232A are canonically equivalent to
// U+3008/U+3009. The data file already lists 2329→232A and 232A→2329 with their
// own o/c types, AND 3008→3009 / 3009→3008. N0 bracket matching compares the
// `paired` code point of an opening bracket against the *actual* closing code
// point on the stack. Because both canonical-equivalent pairs are present and
// self-consistent (2329's partner is 232A, 3008's partner is 3009), no extra
// normalization is needed HERE for same-form matching. The N0 matcher (Task 4+)
// is responsible for treating 2329≡3008 and 232A≡3009 as equal when an opener
// of one form meets a closer of the other; we keep that canonicalization in the
// matcher, not baked into this raw property table (so the table stays a faithful
// mirror of BidiBrackets.txt and remains drift-guardable).
const bracketText = readFileSync(join(dataDir, "BidiBrackets.txt"), "utf8");
interface Bracket {
  cp: number;
  paired: number;
  kindId: number; // 0 = open, 1 = close
}
const brackets: Bracket[] = [];
for (const rawLine of bracketText.split("\n")) {
  const line = rawLine.split("#")[0].trim();
  if (line === "") continue;
  const parts = line.split(";").map((s) => s.trim());
  if (parts.length < 3) continue;
  const cp = parseInt(parts[0], 16);
  const paired = parseInt(parts[1], 16);
  const type = parts[2];
  if (Number.isNaN(cp) || Number.isNaN(paired)) continue;
  if (type !== "o" && type !== "c") continue;
  brackets.push({ cp, paired, kindId: type === "o" ? 0 : 1 });
}
brackets.sort((a, b) => a.cp - b.cp);
const bracketFlat: number[] = [];
for (const b of brackets) bracketFlat.push(b.cp, b.paired, b.kindId);
const bracketOut = `// GENERATED by scripts/gen-uax9-table.ts from Unicode ${UNICODE_VERSION}
// BidiBrackets.txt (Bidi_Paired_Bracket + Bidi_Paired_Bracket_Type). DO NOT EDIT
// BY HAND — run \`npm run gen:uax9\` to regenerate. See data/README.md.
/* eslint-disable */

/** Bracket-pair kind id used in the flat table: 0 = opening, 1 = closing. */
export const BIDI_BRACKET_OPEN = 0;
export const BIDI_BRACKET_CLOSE = 1;

/** Flat sorted [codePoint, pairedCodePoint, kindId] triples; binary-searchable
 *  by the source code point. kindId is BIDI_BRACKET_OPEN or BIDI_BRACKET_CLOSE.
 *  A code point absent from this list is not a paired bracket. */
export const BIDI_BRACKET_TRIPLES: readonly number[] = [
${chunk(bracketFlat, 12).map((row) => "  " + row.join(", ") + ",").join("\n")}
];
`;
const bracketOutFile = join(outDir, "bidi-bracket-table.ts");
writeFileSync(bracketOutFile, bracketOut, "utf8");
console.log(
  `Wrote ${brackets.length} bidi-bracket triples to ${bracketOutFile}`,
);

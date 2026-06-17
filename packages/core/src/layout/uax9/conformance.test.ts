/**
 * UAX #9 conformance gate. Every case in the vendored `BidiCharacterTest.txt`
 * and `BidiTest.txt` (both Unicode 16.0.0) must match `resolveBidiLevels` +
 * `reorderVisual` exactly. This is the correctness gate validating the whole
 * P2/P3 → X → W → N → I → L1/L2 pipeline. Both files run in FULL (no sampling).
 *
 * --- Minimal Node surface ---
 * `@taleweaver/core` compiles for browsers, so its tsconfig omits `@types/node`.
 * This test runs under Node (vitest's default forks pool), so — mirroring
 * `uax14/conformance.test.ts` / `state/encapsulation.test.ts` — we declare exactly
 * the Node surface we touch instead of pulling `@types/node` into the package.
 * Self-contained; no `as any`, no `!`.
 *
 * --- RETAIN-vs-oracle reconciliation (the load-bearing part) ---
 * Our engine RETAINS explicit-format chars + BN (§5.2 retaining model), so
 * `levels`/`types`/`reorderVisual` cover EVERY codepoint. The oracles use the
 * REMOVING model: removed chars are marked `x` in the levels field and ABSENT
 * from the reorder field. We bridge with a `removed[]` mask (true iff the oracle
 * levels field has `x` at that position) and reconcile in TWO ways:
 *
 *  1. Both oracle level/reorder fields are POST-L1 and removing-model. A real
 *     renderer strips the zero-width format chars BEFORE L1/L2, so the harness
 *     COMPACTS `levels`/`types` to the non-removed positions and runs L1 (level
 *     check) + L1/L2 (reorder, via reorderVisual) over the compacted sequence —
 *     NOT over the full retained array with a post-hoc filter. Operating on the
 *     full array and filtering is WRONG in two ways: (a) a removed char between/
 *     after retained whitespace blocks an L1 reset run the removing model
 *     continues (`LRE WS LRE` → trailing WS resets to paragraph level); (b) a
 *     removed char's X-pass level between two retained chars merges L2 runs the
 *     removing model keeps separate (`202E 0028 202C 202B 0061 0029 0062 202C`
 *     → [4 5 6 1], not [1 4 5 6]). This is purely a harness/oracle reconciliation
 *     — the engine is correct as-is (L1 is per-LINE, in reorderVisual; a real
 *     consumer strips format chars per its own line model).
 *  2. `resolveBidiLevels` returns PRE-L1 levels (L1 is line-scoped), so the level
 *     check applies L1's resets (see `applyL1Levels`) before comparing.
 *
 * EMPIRICAL CONVENTION CHECK (hand-verified against both file headers + ~3 rows
 * of each before trusting this harness):
 *   - BidiCharacterTest.txt field 4 = ORIGINAL codepoint indices of the non-`x`
 *     chars, in visual order. (Header: "indices showing the resulting visual
 *     ordering... characters with a resolved level of 'x' are skipped".)
 *     Verified on row `202E 0061 ...;2;0;x 1 x 2 ...;11 9 7 6 5 3 1` — every
 *     reorder entry is an original index drawn from the non-`x` positions.
 *   - BidiTest.txt `@Reorder` = ALSO ORIGINAL indices (NOT compacted). The header
 *     says "indexes into the input string. Items with a level of x are skipped."
 *     Verified on block `@Levels: x 0 0 0` / `@Reorder: 1 2 3` (input "LRE S S B",
 *     LRE removed at index 0): the reorder is `1 2 3` (original indices of the
 *     non-`x` chars), NOT the compacted `0 1 2`. The plan text that anticipated
 *     compacted indices was a misread of the header; per the convention-check
 *     directive we fix the HARNESS (use original indices for BOTH files), never
 *     the engine.
 *   - BidiTest.txt `<bitset>`: bit0(1)=auto-LTR, bit1(2)=LTR, bit2(4)=RTL
 *     (header: "1 = auto-LTR, 2 = LTR, 4 = RTL").
 */
import { describe, it, expect } from "vitest";
import { resolveBidiLevels, type BaseDirection, CC } from "./bidi";
import { bidiClass, type BidiClass } from "./bidi-class";
import { reorderVisual } from "./reorder";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
declare const __dirname: string;
declare function require(id: "fs"): NodeFs;
declare function require(id: "path"): NodePath;
// Minimal `console` surface (the package tsconfig omits `dom`/`@types/node`):
// the BidiTest suite LOGS its stride + covered/total counts (no silent
// truncation), so we declare exactly the one method we touch.
declare const console: { log(...args: unknown[]): void };
const { readFileSync } = require("fs");
const { join } = require("path");

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const here = __dirname; // packages/core/src/layout/uax9
const charTestFile = join(here, "data/BidiCharacterTest.txt");
const bidiTestFile = join(here, "data/BidiTest.txt");

/** Map an oracle paragraph-direction code (0/1/2) to a {@link BaseDirection}. */
function baseFromDirection(code: number): BaseDirection {
  if (code === 0) return "ltr";
  if (code === 1) return "rtl";
  return "auto"; // 2 = auto-LTR per P2/P3
}

/**
 * Apply the UAX #9 L1 level resets over a single line (each conformance case is
 * one line). Returns a fresh post-L1 level array; the inputs are untouched. The
 * caller passes the REMOVING-model (compacted, non-`x`) `levels`/`types` so the
 * end-of-line / pre-S-or-B reset runs match the oracle — see `compareRow`.
 *
 * Both oracle files report POST-L1 levels (BidiTest's `@Levels` and
 * BidiCharacterTest's field 3 both reflect the L1 reset — e.g. a trailing WS or
 * a standalone S/B inside an embedding shows the PARAGRAPH level, not the raised
 * embedding level). `resolveBidiLevels` returns PRE-L1 (resolved I) levels
 * because L1 is a per-LINE operation living in `reorderVisual`. We therefore
 * replicate L1's level resets here to compare against the oracle.
 *
 * L1 resets to `paragraphLevel`, using ORIGINAL types:
 *   i.   every S, ii. every B,
 *   iii. any run of WS / isolate-format chars (LRI/RLI/FSI/PDI) preceding an S/B,
 *   iv.  any run of WS / isolate-format chars at end-of-line.
 * (This mirrors reorder.ts's private L1 pass exactly.)
 */
function applyL1Levels(
  levels: Uint8Array,
  types: Uint8Array,
  paragraphLevel: number,
): Uint8Array {
  const n = levels.length;
  const out = Uint8Array.from(levels);
  const isResetWhitespace = (c: number | undefined): boolean =>
    c === CC.WS || c === CC.LRI || c === CC.RLI || c === CC.FSI || c === CC.PDI;
  let inResetRun = true; // start true → handles the end-of-line tail (rule iv)
  for (let i = n - 1; i >= 0; i--) {
    const c = types[i];
    if (c === CC.S || c === CC.B) {
      out[i] = paragraphLevel;
      inResetRun = true; // whitespace preceding this S/B is resettable (rule iii)
    } else if (inResetRun && isResetWhitespace(c)) {
      out[i] = paragraphLevel;
    } else {
      inResetRun = false;
    }
  }
  return out;
}

/**
 * Shared comparison core for one oracle row. Builds the engine result over the
 * given codepoints, then:
 *  - asserts the resolved paragraph level matches (when the oracle supplies it),
 *  - asserts `levels[i]` matches at every NON-removed position,
 *  - returns the original-index visual order of the non-removed positions
 *    (`visualOriginalNonRemoved`) so each suite can compare it to its reorder
 *    field in that suite's own index space.
 *
 * `oracleLevels` and `removed` are parallel to the codepoints (length = cpCount);
 * `removed[i]` is true iff the oracle levels field had `x` at position `i`.
 */
function compareRow(
  codePoints: number[],
  base: BaseDirection,
  oracleParagraphLevel: number | null,
  oracleLevels: ReadonlyArray<number | null>,
  removed: readonly boolean[],
): { ok: boolean; detail: string; visualOriginalNonRemoved: number[] } {
  const cpCount = codePoints.length;
  const text = codePoints.map((cp) => String.fromCodePoint(cp)).join("");
  const { levels, types, paragraphLevel } = resolveBidiLevels(text, base);

  if (oracleParagraphLevel !== null && paragraphLevel !== oracleParagraphLevel) {
    return {
      ok: false,
      detail: `paragraphLevel got=${paragraphLevel} expected=${oracleParagraphLevel}`,
      visualOriginalNonRemoved: [],
    };
  }

  // BOTH the level check and the reorder must run in the oracle's REMOVING
  // model: a real renderer strips the zero-width explicit-format/BN chars before
  // applying L1/L2, so the retained chars' post-L1 levels AND visual order must
  // be computed over a sequence that EXCLUDES the removed positions. We compact
  // `levels`/`types` to the non-removed positions once, then operate there.
  //
  // Why removing-model (not "operate on full array, filter afterward"):
  //  - L1: a removed char between/after retained whitespace blocks an L1 reset
  //    run that the removing model continues. E.g. `LRE WS LRE` (base ltr): the
  //    trailing LRE is removed, so the WS is end-of-line and L1 resets it to the
  //    paragraph level — which the full-array L1 misses (the retained LRE breaks
  //    the tail run).
  //  - L2: a removed char carrying an X-pass level between two retained chars of
  //    different levels merges L2 runs the removing model keeps separate. E.g.
  //    `202E 0028 202C 202B 0061 0029 0062 202C` → [4 5 6 1] removing-model
  //    (oracle), but [1 4 5 6] if reordered over the full array and filtered.
  const keep: number[] = [];
  for (let i = 0; i < cpCount; i++) if (!removed[i]) keep.push(i);
  const compactLevels = Uint8Array.from(keep.map((i) => levels[i]));
  const compactTypes = Uint8Array.from(keep.map((i) => types[i]));

  // The oracle reports POST-L1 levels; resolveBidiLevels returns pre-L1 levels
  // (L1 is per-line, living in reorderVisual). Apply L1's resets over the
  // compacted single-line sequence before the per-position comparison.
  const compactL1Levels = applyL1Levels(compactLevels, compactTypes, paragraphLevel);
  for (let k = 0; k < keep.length; k++) {
    const orig = nth(keep, k, "kept index");
    const want = oracleLevels[orig];
    if (want !== null && want !== undefined && compactL1Levels[k] !== want) {
      return {
        ok: false,
        detail:
          `levels[${orig}] got=${compactL1Levels[k]} expected=${want} ` +
          `(post-L1 compact=[${[...compactL1Levels].join(" ")}], ` +
          `pre-L1 full=[${[...levels].join(" ")}])`,
        visualOriginalNonRemoved: [],
      };
    }
  }

  // reorderVisual itself applies L1 (over its `types`) then L2, so passing the
  // compacted slice yields the removing-model visual order directly. Map the
  // compacted ranks back to ORIGINAL indices to compare with the oracle.
  const compactVisual = reorderVisual(
    compactLevels,
    compactTypes,
    paragraphLevel,
    0,
    keep.length,
  );
  const visualOriginalNonRemoved = compactVisual.map((rank) => nth(keep, rank, "kept index"));
  return { ok: true, detail: "", visualOriginalNonRemoved };
}

// ===========================================================================
// Suite A — BidiCharacterTest.txt (real codepoints). Run in FULL.
// ===========================================================================

interface CharRow {
  lineNo: number;
  raw: string;
  codePoints: number[];
  base: BaseDirection;
  paragraphLevel: number;
  levels: (number | null)[]; // null for an `x` (removed) position
  removed: boolean[];
  reorder: number[]; // ORIGINAL indices, visual order
}

function parseCharRow(line: string, lineNo: number): CharRow | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const fields = trimmed.split(";");
  if (fields.length < 5) return null;
  const field0 = nth(fields, 0, "codepoints field");
  const field1 = nth(fields, 1, "direction field");
  const field2 = nth(fields, 2, "paragraph-level field");
  const field3 = nth(fields, 3, "levels field");
  const field4 = nth(fields, 4, "reorder field");
  const codePoints = field0
    .trim()
    .split(/\s+/)
    .map((h) => parseInt(h, 16));
  const base = baseFromDirection(parseInt(field1.trim(), 10));
  const paragraphLevel = parseInt(field2.trim(), 10);
  const levelToks = field3.trim() === "" ? [] : field3.trim().split(/\s+/);
  const levels: (number | null)[] = levelToks.map((t) =>
    t === "x" ? null : parseInt(t, 10),
  );
  const removed = levelToks.map((t) => t === "x");
  const reorder =
    field4.trim() === "" ? [] : field4.trim().split(/\s+/).map((t) => parseInt(t, 10));
  return { lineNo, raw: trimmed, codePoints, base, paragraphLevel, levels, removed, reorder };
}

describe("UAX #9 conformance — BidiCharacterTest.txt (Unicode 16.0.0)", () => {
  const lines = readFileSync(charTestFile, "utf8").split("\n");
  const rows: CharRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = parseCharRow(nth(lines, i, "line"), i + 1);
    if (r !== null) rows.push(r);
  }

  it("parses a non-trivial number of conformance rows", () => {
    expect(rows.length).toBeGreaterThan(1000);
  });

  it("matches every BidiCharacterTest.txt row exactly (levels + paragraph level + reorder)", () => {
    const failures: string[] = [];
    for (const row of rows) {
      const res = compareRow(
        row.codePoints,
        row.base,
        row.paragraphLevel,
        row.levels,
        row.removed,
      );
      if (!res.ok) {
        failures.push(`line ${row.lineNo}: ${res.detail}\n  raw: ${row.raw}`);
      } else if (
        res.visualOriginalNonRemoved.length !== row.reorder.length ||
        res.visualOriginalNonRemoved.some((v, k) => v !== row.reorder[k])
      ) {
        failures.push(
          `line ${row.lineNo}: reorder got=[${res.visualOriginalNonRemoved.join(" ")}] ` +
            `expected=[${row.reorder.join(" ")}]\n  raw: ${row.raw}`,
        );
      }
      if (failures.length >= 20) break;
    }
    expect(failures, `\n${failures.join("\n")}`).toHaveLength(0);
  });
});

// ===========================================================================
// Suite B — BidiTest.txt (class-sequence cases). DETERMINISTIC SAMPLING.
//
// BidiTest.txt holds millions of synthesized cases; running the whole file in a
// single vitest worker is too slow for the suite. We sample a DETERMINISTIC
// stride and LOG both the stride and the covered count (NO silent truncation).
// The full file is still parsed; only the per-data-line assertion is strided.
// ===========================================================================

/** One representative codepoint whose `bidiClass` is exactly that class. `ON`
 *  uses `!` (U+0021), NOT a bracket — BidiTest assumes no paired brackets. */
const REP: Record<BidiClass, number> = {
  L: 0x0041, R: 0x05d0, AL: 0x0627, EN: 0x0030, ES: 0x002b, ET: 0x0024,
  AN: 0x0660, CS: 0x002c, NSM: 0x0300, BN: 0x00ad, B: 0x2029, S: 0x0009,
  WS: 0x0020, ON: 0x0021,
  LRE: 0x202a, RLE: 0x202b, LRO: 0x202d, RLO: 0x202e, PDF: 0x202c,
  LRI: 0x2066, RLI: 0x2067, FSI: 0x2068, PDI: 0x2069,
};

/**
 * Stride for BidiTest.txt data-line × base-direction expansions (1 = full file,
 * no sampling). The full file (~770K expansions) completes in ~2s isolated — this
 * is the conformance gate, run in full. Full-suite CPU contention can slow it past
 * the default 5s test timeout, so the `it` carries a generous explicit timeout
 * (preferred over sampling, which would silently shrink coverage). The run LOGS the
 * stride + covered/total counts, so any future sampling would be announced.
 */
const BIDI_TEST_STRIDE = 1;

describe("UAX #9 conformance — BidiTest.txt (Unicode 16.0.0)", () => {
  it("REP table is self-consistent (bidiClass(REP[c]) === c for every class)", () => {
    const wrong: string[] = [];
    for (const name of Object.keys(REP)) {
      const cls = name as BidiClass;
      const got = bidiClass(REP[cls]);
      if (got !== cls) wrong.push(`REP[${cls}]=U+${REP[cls].toString(16)} classified as ${got}`);
    }
    expect(wrong, `\n${wrong.join("\n")}`).toHaveLength(0);
  });

  it(`matches sampled BidiTest.txt cases (stride=${BIDI_TEST_STRIDE})`, () => {
    const lines = readFileSync(bidiTestFile, "utf8").split("\n");

    // Active @Levels / @Reorder directives for the current block.
    let levelToks: string[] = [];
    let reorderToks: number[] = [];

    let dataLineSeq = 0; // counts EVERY (data line × base) expansion, for striding
    let covered = 0;
    let totalExpansions = 0;
    const failures: string[] = [];

    for (let li = 0; li < lines.length; li++) {
      const rawLine = nth(lines, li, "line");
      const noComment = rawLine.split("#")[0] ?? "";
      const body = noComment.trim();
      if (body === "") continue;

      if (body.startsWith("@Levels:")) {
        const rest = body.slice("@Levels:".length).trim();
        levelToks = rest === "" ? [] : rest.split(/\s+/);
        continue;
      }
      if (body.startsWith("@Reorder:")) {
        const rest = body.slice("@Reorder:".length).trim();
        reorderToks = rest === "" ? [] : rest.split(/\s+/).map((t) => parseInt(t, 10));
        continue;
      }

      // Data line: "<classes> ; <bitset>"
      const semi = body.indexOf(";");
      if (semi === -1) continue;
      const classPart = body.slice(0, semi).trim();
      const bitsetPart = body.slice(semi + 1).trim();
      if (classPart === "" || bitsetPart === "") continue;
      const classNames = classPart.split(/\s+/);
      const bitset = parseInt(bitsetPart, 16);

      // bit0(1)=auto, bit1(2)=LTR, bit2(4)=RTL  (header-confirmed)
      const dirs: { bit: number; base: BaseDirection }[] = [
        { bit: 1, base: "auto" },
        { bit: 2, base: "ltr" },
        { bit: 4, base: "rtl" },
      ];

      // Build codepoints + removed-mask from the @Levels directive ONCE per line.
      const codePoints: number[] = [];
      let unknownClass = false;
      for (const name of classNames) {
        if (!(name in REP)) {
          unknownClass = true;
          break;
        }
        codePoints.push(REP[name as BidiClass]);
      }
      if (unknownClass) continue;

      const oracleLevels: (number | null)[] = levelToks.map((t) =>
        t === "x" ? null : parseInt(t, 10),
      );
      const removed = levelToks.map((t) => t === "x");
      // @Reorder is in ORIGINAL indices (see header convention check above).
      const expectedReorder = reorderToks;

      for (const { bit, base } of dirs) {
        if ((bitset & bit) === 0) continue;
        totalExpansions++;
        const myIndex = dataLineSeq++;
        if (myIndex % BIDI_TEST_STRIDE !== 0) continue;
        covered++;

        const res = compareRow(codePoints, base, null, oracleLevels, removed);
        if (!res.ok) {
          failures.push(
            `line ${li + 1} base=${base}: ${res.detail}\n  classes: ${classPart}`,
          );
        } else if (
          res.visualOriginalNonRemoved.length !== expectedReorder.length ||
          res.visualOriginalNonRemoved.some((v, k) => v !== expectedReorder[k])
        ) {
          failures.push(
            `line ${li + 1} base=${base}: reorder got=[${res.visualOriginalNonRemoved.join(" ")}] ` +
              `expected=[${expectedReorder.join(" ")}]\n  classes: ${classPart}`,
          );
        }
        if (failures.length >= 20) break;
      }
      if (failures.length >= 20) break;
    }

    // NO silent truncation — announce exactly what was covered vs skipped.
    console.log(
      `[BidiTest.txt] stride=${BIDI_TEST_STRIDE}; covered ${covered} of ${totalExpansions} ` +
        `(data line × base) expansions.`,
    );
    // Check correctness FIRST (so a real mismatch is reported, not masked by the
    // coverage floor when an early break trims `covered`).
    expect(failures, `\n${failures.join("\n")}`).toHaveLength(0);
    expect(covered).toBeGreaterThan(10000);
    // Generous per-test timeout (the default 5s flakes under full-suite CPU
    // contention — this run is ~2s isolated but ~5.5s contended). Raising the
    // timeout keeps FULL stride=1 coverage rather than sampling it away.
  }, 30_000);
});

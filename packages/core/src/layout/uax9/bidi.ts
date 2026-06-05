import { bidiClass, type BidiClass } from "./bidi-class";

/**
 * UAX #9 Unicode Bidirectional Algorithm — rule engine.
 *
 * This file is the foundation for the resolution phases. It currently
 * implements P2/P3 (paragraph embedding-level detection); the X (explicit
 * levels), W (weak types), N (neutrals), and I (implicit levels) passes land in
 * later tasks. All passes operate on a compact per-codepoint `Uint8Array` of
 * CLASS CODES (small ints) rather than `BidiClass` strings, for hot-path speed.
 *
 * MODULE-INTERNAL: nothing here is re-exported from any barrel / package
 * `index.ts`. Consumers import from this file directly.
 */

export type BaseDirection = "ltr" | "rtl" | "auto";

export interface BidiResult {
  /** Per-input-CODEPOINT resolved embedding level (NOT per UTF-16 unit). */
  readonly levels: Uint8Array;
  /** Per-input-codepoint ORIGINAL bidi class (used by L1 in reorder). */
  readonly types: Uint8Array;
  readonly paragraphLevel: number;
}

/**
 * The 23 UAX #9 Bidi_Class values in a FIXED, stable order. The index of each
 * class in this array IS its class code (the value stored in the `types`
 * Uint8Array). DO NOT REORDER — later passes (X/W/N/I) and any persisted
 * artifacts depend on this exact ordering.
 *
 * Order (codes 0..22):
 *   0:L 1:R 2:AL 3:EN 4:ES 5:ET 6:AN 7:CS 8:NSM 9:BN 10:B 11:S 12:WS 13:ON
 *   14:LRE 15:RLE 16:LRO 17:RLO 18:PDF 19:LRI 20:RLI 21:FSI 22:PDI
 *
 * (This mirrors the union declaration order in bidi-class.ts: the strong/weak/
 * neutral classes first, then the explicit-formatting classes.)
 */
export const BIDI_CLASS_CODES: readonly BidiClass[] = [
  "L", "R", "AL", "EN", "ES", "ET", "AN", "CS", "NSM", "BN",
  "B", "S", "WS", "ON",
  "LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI",
] as const;

/** Reverse lookup: class name → its fixed class code. Built once at module load. */
const CODE_BY_NAME: ReadonlyMap<BidiClass, number> = new Map(
  BIDI_CLASS_CODES.map((name, i) => [name, i] as const),
);

/** Class name → class code. Throws on an unknown name (cannot happen for the
 *  fixed union, but keeps the function total without a non-null assertion). */
export function code(name: BidiClass): number {
  const c = CODE_BY_NAME.get(name);
  if (c === undefined) throw new Error(`unknown bidi class: ${name}`);
  return c;
}

/** Code point → its bidi class code (the hot-path representation). */
export function classCode(codePoint: number): number {
  return code(bidiClass(codePoint));
}

/**
 * Named numeric constants for every bidi class, keyed by class code. The
 * algorithm passes branch on these instead of comparing strings.
 */
export const CC = {
  L: code("L"),
  R: code("R"),
  AL: code("AL"),
  EN: code("EN"),
  ES: code("ES"),
  ET: code("ET"),
  AN: code("AN"),
  CS: code("CS"),
  NSM: code("NSM"),
  BN: code("BN"),
  B: code("B"),
  S: code("S"),
  WS: code("WS"),
  ON: code("ON"),
  LRE: code("LRE"),
  RLE: code("RLE"),
  LRO: code("LRO"),
  RLO: code("RLO"),
  PDF: code("PDF"),
  LRI: code("LRI"),
  RLI: code("RLI"),
  FSI: code("FSI"),
  PDI: code("PDI"),
} as const;

/**
 * UAX #9 rules P2 and P3 — compute the paragraph (base) embedding level for the
 * class-code run `types[start, end)`.
 *
 * P2: find the first character of class L, AL, or R, **skipping any characters
 * between an isolate initiator (LRI/RLI/FSI) and its matching PDI** (or, for an
 * unmatched initiator, the end of the range). P3: if such a character is found
 * and it is AL or R, the level is 1; otherwise (L found, or no strong char
 * found) the level is 0.
 *
 * This is also reused by X5c (FSI direction detection, a later task) to derive
 * an isolate's direction from its enclosed text — hence it is exported for tests
 * + intra-module reuse, but is MODULE-INTERNAL (never barrel-exported).
 */
export function computeParagraphLevel(
  types: Uint8Array,
  start: number,
  end: number,
): number {
  let isolateDepth = 0;
  for (let i = start; i < end; i++) {
    const t = types[i];
    if (t === CC.LRI || t === CC.RLI || t === CC.FSI) {
      isolateDepth++;
    } else if (t === CC.PDI) {
      if (isolateDepth > 0) isolateDepth--;
    } else if (isolateDepth === 0) {
      if (t === CC.L) return 0;
      if (t === CC.R || t === CC.AL) return 1;
    }
  }
  // P3: no strong character at depth 0 → default LTR.
  return 0;
}

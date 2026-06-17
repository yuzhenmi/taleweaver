import { BIDI_MIRROR_PAIRS } from "./bidi-mirror-table";
import {
  BIDI_BRACKET_TRIPLES,
  BIDI_BRACKET_OPEN,
} from "./bidi-bracket-table";

/**
 * Binary-search a flat sorted pair list `[key0, val0, key1, val1, ...]` (stride
 * 2) for `key`. Returns the value paired with `key`, or null if absent.
 */
function lookupPair(table: readonly number[], key: number): number | null {
  let lo = 0;
  let hi = table.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const base = mid * 2;
    const k = table[base];
    const v = table[base + 1];
    if (k === undefined || v === undefined) {
      throw new Error(`lookupPair: table entry ${base} missing (unreachable)`);
    }
    if (key < k) hi = mid - 1;
    else if (key > k) lo = mid + 1;
    else return v;
  }
  return null;
}

/**
 * Binary-search the flat sorted bracket triple list `[cp, paired, kindId, ...]`
 * (stride 3) for `cp`. Returns the base index of the matched triple, or -1.
 */
function findBracket(cp: number): number {
  const table = BIDI_BRACKET_TRIPLES;
  let lo = 0;
  let hi = table.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const base = mid * 3;
    const k = table[base];
    if (k === undefined) {
      throw new Error(`findBracket: bracket table entry ${base} missing (unreachable)`);
    }
    if (cp < k) hi = mid - 1;
    else if (cp > k) lo = mid + 1;
    else return base;
  }
  return -1;
}

/**
 * UAX #9 L4 mirror identification: the Bidi_Mirroring_Glyph of `cp`, or null if
 * the code point has no mirrored counterpart.
 */
export function bidiMirror(cp: number): number | null {
  return lookupPair(BIDI_MIRROR_PAIRS, cp);
}

/**
 * N0 (BD16) helper: the bracket-pair info for `cp`, or null if `cp` is not a
 * paired bracket. `kind` distinguishes opening ("open") from closing ("close")
 * brackets; `paired` is the matching opposite bracket's code point.
 *
 * `paired` is the RAW, faithful property value (so the generated table stays a
 * drift-guardable mirror of the source data). The N0 matcher MUST apply
 * `canonicalBracketEquiv` (below) to both the expected and the actual closer
 * before comparing — see its docstring.
 */
export function bracketPair(
  cp: number,
): { paired: number; kind: "open" | "close" } | null {
  const base = findBracket(cp);
  if (base === -1) return null;
  const paired = BIDI_BRACKET_TRIPLES[base + 1];
  const kindId = BIDI_BRACKET_TRIPLES[base + 2];
  if (paired === undefined || kindId === undefined) {
    throw new Error(`bracketPair: bracket triple at ${base} missing (unreachable)`);
  }
  return { paired, kind: kindId === BIDI_BRACKET_OPEN ? "open" : "close" };
}

/**
 * UAX #9 BD16 canonical-equivalence normalization for bracket matching. The ONLY
 * two bracket code points with a canonical equivalent in Unicode are U+2329 ⟨
 * (≡ U+3008 〈) and U+232A ⟩ (≡ U+3009 〉). BD16 says: when matching a bracket
 * pair, compare using the canonical equivalent. So the N0 matcher must normalize
 * BOTH sides of the comparison through this function:
 *
 *   - on an opener `o`, store `canonicalBracketEquiv(bracketPair(o).paired)`;
 *   - on a closer `c`, compare `canonicalBracketEquiv(c)` against the stored key.
 *
 * This correctly matches all four cross-form combinations (2329 opener with a
 * 3009 closer, 3008 opener with a 232A closer, etc.) AND the same-form cases —
 * which a naive `bracketPair(o).paired === c` check would miss. Identity for
 * every code point other than the two angle-bracket pairs.
 */
export function canonicalBracketEquiv(cp: number): number {
  // 2329 ⟨ → 3008 〈 ; 232A ⟩ → 3009 〉 (3008/3009 already canonical → identity).
  if (cp === 0x2329) return 0x3008;
  if (cp === 0x232a) return 0x3009;
  return cp;
}

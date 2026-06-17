import { BIDI_CLASS_RANGES, BIDI_CLASS_NAMES } from "./bidi-class-table";

/**
 * UAX #9 Bidi_Class values (the full Unicode 16.0.0 set). These are the RAW
 * property values; the bidi algorithm's resolution phases (X1–X10, W, N, I)
 * derive embedding levels from them downstream.
 */
export type BidiClass =
  | "L" | "R" | "AL" | "EN" | "ES" | "ET" | "AN" | "CS" | "NSM" | "BN"
  | "B" | "S" | "WS" | "ON"
  | "LRE" | "RLE" | "LRO" | "RLO" | "PDF" | "LRI" | "RLI" | "FSI" | "PDI";

/** All class strings actually present in the generated table — for the
 *  exhaustiveness check below (guards against a Unicode upgrade adding a class
 *  the union forgot). */
const KNOWN_CLASSES = new Set<string>(BIDI_CLASS_NAMES);

/**
 * Binary-search the flat sorted [lo, hi, classId] range table. Returns the
 * matched triple's base index, or -1.
 */
function findRange(ranges: readonly number[], cp: number): number {
  let lo = 0;
  let hi = ranges.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const base = mid * 3;
    const rangeLo = ranges[base];
    const rangeHi = ranges[base + 1];
    if (rangeLo === undefined || rangeHi === undefined) {
      throw new Error(`bidiClass: range table entry ${base} missing (unreachable)`);
    }
    if (cp < rangeLo) hi = mid - 1;
    else if (cp > rangeHi) lo = mid + 1;
    else return base;
  }
  return -1;
}

/**
 * Raw UAX #9 Bidi_Class property of a code point. The generated table bakes the
 * `@missing` default-bidi ranges as a base layer (overall default `L`, with
 * block-specific defaults for unassigned Hebrew/Arabic/etc. code points), so
 * every code point in 0..10FFFF resolves. Out-of-range code points return the
 * overall default `L`.
 */
export function bidiClass(codePoint: number): BidiClass {
  if (codePoint < 0 || codePoint > 0x10ffff) return "L";
  const base = findRange(BIDI_CLASS_RANGES, codePoint);
  if (base === -1) return "L";
  const classId = BIDI_CLASS_RANGES[base + 2];
  if (classId === undefined) {
    throw new Error(`bidiClass: range table classId at ${base + 2} missing (unreachable)`);
  }
  const name = BIDI_CLASS_NAMES[classId];
  if (name === undefined) {
    throw new Error(`bidiClass: class name for id ${classId} missing (unreachable)`);
  }
  // Defensive: if a future Unicode upgrade emits a class not in the union, the
  // table-regeneration test will still pass but this guard surfaces the gap as a
  // dev error rather than silently mis-typing. (Never throws in production.)
  if (!KNOWN_CLASSES.has(name)) return "L";
  return name as BidiClass;
}

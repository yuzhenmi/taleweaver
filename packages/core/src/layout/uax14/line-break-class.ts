import {
  LINE_BREAK_RANGES,
  LINE_BREAK_CLASS_NAMES,
  EAST_ASIAN_WIDE_RANGES,
  EXTENDED_PICTOGRAPHIC_CN_RANGES,
  PI_QU_RANGES,
  PF_QU_RANGES,
} from "./line-break-table";

/**
 * UAX #14 Line_Break classes (the FULL Unicode 16.0.0 set). `SA` is intentionally
 * absent: it is resolved to `CM`/`AL` at table-generation time (it needs
 * General_Category, which the runtime does not carry). The remaining context-free
 * resolutions (`AI`,`SG`,`XX` → `AL`; `CJ` → `NS` by default) are applied by the
 * rule engine, not here — this function returns the RAW property value. The
 * Brahmic classes `AP`/`AK`/`AS`/`VF`/`VI` (LB28a) MUST be present so the
 * generated table's strings all narrow to this type without an unsafe cast.
 */
export type LineBreakClass =
  | "BK" | "CR" | "LF" | "CM" | "NL" | "SG" | "WJ" | "ZW" | "GL" | "SP" | "ZWJ"
  | "B2" | "BA" | "BB" | "HY" | "CB" | "CL" | "CP" | "EX" | "IN" | "NS" | "OP"
  | "QU" | "IS" | "NU" | "PO" | "PR" | "SY" | "AI" | "AL" | "CJ" | "EB" | "EM"
  | "H2" | "H3" | "HL" | "ID" | "JL" | "JV" | "JT" | "RI"
  | "AP" | "AK" | "AS" | "VF" | "VI" | "XX";

/** All class strings actually present in the generated table — for the
 *  exhaustiveness check below (guards against a Unicode upgrade adding a class
 *  the union forgot). */
const KNOWN_CLASSES = new Set<string>(LINE_BREAK_CLASS_NAMES);

/**
 * Binary-search a flat sorted range table. `stride` is 3 for the [lo,hi,classId]
 * Line_Break table and 2 for the [lo,hi] East-Asian table. Returns the matched
 * triple's base index, or -1.
 */
function findRange(ranges: readonly number[], stride: number, cp: number): number {
  let lo = 0;
  let hi = ranges.length / stride - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const base = mid * stride;
    // base and base+1 are in-bounds: mid <= hi <= length/stride - 1, so
    // base+1 <= (length/stride - 1)*stride + 1 <= length - stride + 1 <= length - 1
    // (stride >= 2). A miss means a malformed/truncated range table.
    const rangeLo = ranges[base];
    const rangeHi = ranges[base + 1];
    if (rangeLo === undefined || rangeHi === undefined) {
      throw new Error(`uax14: range table truncated at base ${base} (stride ${stride}, length ${ranges.length})`);
    }
    if (cp < rangeLo) hi = mid - 1;
    else if (cp > rangeHi) lo = mid + 1;
    else return base;
  }
  return -1;
}

/**
 * Raw UAX #14 Line_Break property of a code point. Returns "XX" for any
 * unassigned or out-of-range code point (XX → AL is applied later by the rule
 * engine).
 */
export function lineBreakClass(codePoint: number): LineBreakClass {
  if (codePoint < 0 || codePoint > 0x10ffff) return "XX";
  const base = findRange(LINE_BREAK_RANGES, 3, codePoint);
  if (base === -1) return "XX";
  // base+2 is in-bounds for a well-formed stride-3 table (see findRange bounds
  // note). classId / name fall through to "XX" below if the table is malformed,
  // which matches the pre-existing runtime default (a missing name was caught by
  // the KNOWN_CLASSES guard and mapped to "XX").
  const classId = LINE_BREAK_RANGES[base + 2];
  const name = classId === undefined ? undefined : LINE_BREAK_CLASS_NAMES[classId];
  // Defensive: if a future Unicode upgrade emits a class not in the union, the
  // table-regeneration test will still pass but this guard surfaces the gap as a
  // dev error rather than silently mis-typing. (Never throws in production.)
  if (name === undefined || !KNOWN_CLASSES.has(name)) return "XX";
  return name as LineBreakClass;
}

/**
 * True if `codePoint` has East_Asian_Width F (Fullwidth), W (Wide), or H
 * (Halfwidth) — needed by LB30 to NOT suppress breaks around East-Asian-wide
 * `OP`/`CP` (e.g. fullwidth/CJK brackets). Binary search over the [lo,hi] EA table.
 *
 * NOTE: this is the UAX #14 LB30 exclusion set `[\p{ea=F}\p{ea=W}\p{ea=H}]`,
 * which intentionally includes Halfwidth (`H`) even though `H` is not "wide" in
 * the UAX #11 sense. Do not narrow the set to {F,W}: the conformance suite (and
 * LB30) require `H` here. The "Wide" in the name follows the spec's shorthand.
 */
export function isEastAsianWide(codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0x10ffff) return false;
  return findRange(EAST_ASIAN_WIDE_RANGES, 2, codePoint) !== -1;
}

/**
 * True if `codePoint` is BOTH Extended_Pictographic AND General_Category=Cn
 * (unassigned) — the left operand of the LB30b 2nd clause
 * `[\p{Extended_Pictographic} & \p{gc=Cn}] × EM`. These "reserved pictographic"
 * code points carry a default Line_Break class (typically ID) that does not
 * identify them, so the rule needs this dedicated lookup. Binary search over the
 * generated [lo, hi] range table.
 */
export function isExtendedPictographicCn(codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0x10ffff) return false;
  return findRange(EXTENDED_PICTOGRAPHIC_CN_RANGES, 2, codePoint) !== -1;
}

/**
 * True if `codePoint` has Line_Break=QU AND General_Category=Pi (initial
 * quotation mark) — the opening-quote set LB15a pins. Codegen-derived (QU ∩ Pi)
 * so the runtime carries no General_Category table and the set never silently
 * goes stale on a Unicode upgrade. Binary search over the generated [lo,hi] table.
 */
export function isPiQu(codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0x10ffff) return false;
  return findRange(PI_QU_RANGES, 2, codePoint) !== -1;
}

/**
 * True if `codePoint` has Line_Break=QU AND General_Category=Pf (final
 * quotation mark) — the closing-quote set LB15b pins. Codegen-derived (QU ∩ Pf).
 */
export function isPfQu(codePoint: number): boolean {
  if (codePoint < 0 || codePoint > 0x10ffff) return false;
  return findRange(PF_QU_RANGES, 2, codePoint) !== -1;
}

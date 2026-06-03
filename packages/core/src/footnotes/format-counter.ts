/**
 * @module footnotes/format-counter
 *
 * Pure counter-format function for footnote markers (FN-3). Maps a 1-based
 * counter value to its displayed BARE string under one of the Google-Docs
 * footnote number formats — "1", "iv", "A", "*".
 *
 * BARE (no trailing `"."`): this is the reference number used by the inline
 * superscript CALL marker, which reads like a bare superscript ("1"). The
 * bottom-slot BODY marker reads like a numbered list ("1.") — that trailing
 * `"."` suffix is added DOWNSTREAM in `render-footnotes.ts`'s `makeRenderContext` body
 * accessor (symbol-exempt), so the two markers intentionally differ. Keep this
 * function bare; do not add the dot here.
 *
 * NOTE on DRY (P9a alignment): a list-marker formatter already exists at
 * `layout/list-counter.ts` with overlapping roman/alpha logic. It is NOT reused
 * here because it has no `symbol` format (the *,†,‡,§ footnote cycle), which
 * footnotes need and lists do not. When P9a lands a general CSS `counter()`
 * formatter, BOTH this and `list-counter.ts` collapse into it behind their
 * current call sites (the footnote `CounterFormat` ⇒ a counter style, the `.`
 * suffix ⇒ the list `<suffix>` separator). Until then the bijective-base-26 and
 * roman logic is duplicated DELIBERATELY; see FN-3 status report.
 */

/** The footnote number formats (a subset of CSS `list-style-type`, + `symbol`). */
export type CounterFormat =
  | "decimal"
  | "lower-roman"
  | "upper-roman"
  | "lower-alpha"
  | "upper-alpha"
  | "symbol";

/**
 * The traditional typographic footnote symbol cycle (Chicago / Word / Google
 * Docs): asterisk, dagger, double-dagger, section, parallel-bars, pilcrow. Past
 * the sixth symbol the glyph DOUBLES (`**`, `††`, …), then triples, etc.
 */
const SYMBOL_CYCLE = ["*", "†", "‡", "§", "‖", "¶"] as const;

/**
 * Format a 1-based counter `value` under `format`.
 *
 * @throws if `value` is not a positive integer (the numbering engine produces
 *   1-based values; a non-positive or fractional value signals a caller bug,
 *   and silently coercing it would hide that).
 */
export function formatCounter(value: number, format: CounterFormat): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `formatCounter: value must be a positive integer, got ${value}`,
    );
  }
  switch (format) {
    // All formats are BARE here (the call marker is a bare superscript); the
    // body marker's "." suffix is added downstream (see module docstring).
    case "decimal":
      return `${value}`;
    case "lower-roman":
      return toRoman(value).toLowerCase();
    case "upper-roman":
      return toRoman(value);
    case "lower-alpha":
      return toAlpha(value, 0x61 /* 'a' */);
    case "upper-alpha":
      return toAlpha(value, 0x41 /* 'A' */);
    case "symbol":
      return toSymbol(value);
  }
}

/** Bijective base-26: 1→a, 26→z, 27→aa, 52→az, 53→ba (no zero digit). */
function toAlpha(n: number, baseCharCode: number): string {
  let s = "";
  let cur = n;
  while (cur > 0) {
    cur -= 1;
    s = String.fromCharCode(baseCharCode + (cur % 26)) + s;
    cur = Math.floor(cur / 26);
  }
  return s;
}

/** Standard subtractive Roman numerals (upper-case; caller lower-cases). */
function toRoman(n: number): string {
  const pairs: ReadonlyArray<readonly [number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let s = "";
  let cur = n;
  for (const [v, lit] of pairs) {
    while (cur >= v) {
      s += lit;
      cur -= v;
    }
  }
  return s;
}

/**
 * The footnote symbol sequence: cycle through `SYMBOL_CYCLE`, repeating each
 * glyph one more time per completed cycle. 1→`*`, 6→`¶`, 7→`**`, 13→`***`.
 */
function toSymbol(n: number): string {
  const zeroBased = n - 1;
  const index = zeroBased % SYMBOL_CYCLE.length;
  const repeats = Math.floor(zeroBased / SYMBOL_CYCLE.length) + 1;
  return SYMBOL_CYCLE[index].repeat(repeats);
}

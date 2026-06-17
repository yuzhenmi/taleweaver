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
 * DRY (P9a alignment): the five non-`symbol` formats (decimal/lower-roman/
 * upper-roman/lower-alpha/upper-alpha) DELEGATE to the single shared bare
 * `formatCounter` in `styles/format-counter.ts` — the same formatter the list
 * markers and CSS `counter()` use. This file keeps ONLY the footnote-specific
 * concerns the shared formatter doesn't carry: the `symbol` cycle (`*,†,‡,§`,
 * NOT a CSS `list-style-type`) and the positive-integer guard.
 */

import { formatCounter as formatBareCounter } from "../styles/format-counter";

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
  // The `symbol` cycle is footnote-only (not a CSS list-style-type). Every
  // other format delegates to the single shared bare formatter — its output is
  // BARE here too (the call marker is a bare superscript); the body marker's "."
  // suffix is added downstream (see module docstring).
  if (format === "symbol") {
    return toSymbol(value);
  }
  return formatBareCounter(value, format);
}

/**
 * The footnote symbol sequence: cycle through `SYMBOL_CYCLE`, repeating each
 * glyph one more time per completed cycle. 1→`*`, 6→`¶`, 7→`**`, 13→`***`.
 */
function toSymbol(n: number): string {
  const zeroBased = n - 1;
  const index = zeroBased % SYMBOL_CYCLE.length;
  const repeats = Math.floor(zeroBased / SYMBOL_CYCLE.length) + 1;
  // `index` is a non-negative modulo of the cycle length, always in range.
  const glyph = SYMBOL_CYCLE[index];
  if (glyph === undefined) {
    throw new Error(
      `format-counter: symbol index ${index} out of range (cycle length ${SYMBOL_CYCLE.length})`,
    );
  }
  return glyph.repeat(repeats);
}

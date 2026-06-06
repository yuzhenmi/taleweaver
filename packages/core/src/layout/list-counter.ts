import { type CounterStyle, formatCounter as formatBareCounter } from "../styles/format-counter";

// Re-exported so existing layout consumers can keep importing `CounterStyle`
// from here; its canonical home is now the leaf `styles/format-counter`.
export type { CounterStyle };

/**
 * The algorithmic (numeric/alpha/roman) list styles whose marker is the bare
 * counter string followed by a `"."` suffix. The bullet styles (disc/circle/
 * square) are NOT here: their marker is the glyph alone with no dot, resolved
 * directly in `bfc.ts`'s `resolveMarkerText`.
 */
export type NumberedListStyle =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

/**
 * Format a numbered-list marker: the shared BARE counter string plus the list's
 * `"."` suffix (e.g. `1.`, `iv.`, `AA.`). The dot is the LIST MARKER's concern
 * (the CSS `<suffix>` separator), so it is appended HERE around the shared bare
 * `formatCounter` — the bare formatter never emits a suffix.
 */
export function formatCounter(value: number, style: NumberedListStyle): string {
  return `${formatBareCounter(value, style)}.`;
}

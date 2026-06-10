/**
 * @module styles/format-counter
 *
 * The single shared, BARE counter formatter for the engine. Maps a counter
 * value to its displayed string under one CSS `list-style-type`-derived style.
 *
 * BARE = no trailing suffix. The `"."` of a numbered-list marker ("1.") and the
 * `"."` of a footnote BODY marker are the CALLER's concern — they append it
 * around this function (see `layout/list-counter.ts` and the footnote render
 * context). Numeric/alpha/roman styles format to their bare string; the bullet
 * styles disc/circle/square format to their marker glyph.
 *
 * `styles/` is a LEAF module: this file imports nothing from elsewhere in core
 * (no `layout`, no `footnotes`). Cascade (CSS `counter()`/`counters()`), layout
 * list markers, and footnote numbering all share this one implementation.
 */

/**
 * The counter styles shared by CSS `counter()`/`counters()`, list markers, and
 * footnote numbering. A subset of CSS `list-style-type`: the numeric/alpha/roman
 * algorithmic styles plus the three bullet glyphs. (Footnotes additionally have
 * a `symbol` cycle that is NOT here — it lives in `footnotes/format-counter.ts`.)
 */
export type CounterStyle =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman"
  | "disc"
  | "circle"
  | "square";

const COUNTER_STYLES: ReadonlySet<string> = new Set<CounterStyle>([
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
  "disc",
  "circle",
  "square",
]);

/**
 * Runtime type guard for {@link CounterStyle}. Used to validate a value read from
 * an open-schema source (embed `properties`, block `attrs`) before treating it as
 * a `CounterStyle` — no unsafe cast.
 */
export function isCounterStyle(value: unknown): value is CounterStyle {
  return typeof value === "string" && COUNTER_STYLES.has(value);
}

/**
 * Format `value` under `style`, BARE (no suffix).
 *
 * - decimal → "1"
 * - lower-alpha/upper-alpha → bijective base-26 ("a"…"z","aa"…)
 * - lower-roman/upper-roman → subtractive roman ("i","iv","mcmxciv")
 * - disc/circle/square → the bullet glyph ("•"/"○"/"▪")
 */
export function formatCounter(value: number, style: CounterStyle): string {
  switch (style) {
    case "decimal":
      return `${value}`;
    case "lower-alpha":
      return toAlpha(value, 0x61 /* 'a' */);
    case "upper-alpha":
      return toAlpha(value, 0x41 /* 'A' */);
    case "lower-roman":
      return toRoman(value).toLowerCase();
    case "upper-roman":
      return toRoman(value);
    case "disc":
      return "•"; // •
    case "circle":
      return "○"; // ○
    case "square":
      return "▪"; // ▪
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
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

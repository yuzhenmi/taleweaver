/**
 * `Length` — declared/specified value. What components return; what users
 * write in inline styles.
 */
export type Length =
  | number                                            // shorthand for px
  | { readonly unit: "px"; readonly value: number }
  | { readonly unit: "percent"; readonly value: number }
  | { readonly unit: "em"; readonly value: number };

export type LengthOrAuto = Length | "auto";

/**
 * `ComputedLength` — produced by the cascade. `em`/`rem` are resolved to
 * absolute px; `percent` stays symbolic for layout-time resolution.
 */
export type ComputedLength =
  | number                                            // px
  | { readonly unit: "percent"; readonly value: number };

export type ComputedLengthOrAuto = ComputedLength | "auto";

/**
 * `UsedLength` — produced by layout. Fully numeric: `percent` resolved
 * against the containing block, `auto` resolved per FC algorithm.
 */
export type UsedLength = number;

export type UsedLengthOrAuto = UsedLength | "auto";

/**
 * CSS Sizing 3 intrinsic-sizing keywords. Accepted by all `*-size` properties.
 */
export type IntrinsicSizingKeyword = "min-content" | "max-content" | "fit-content";

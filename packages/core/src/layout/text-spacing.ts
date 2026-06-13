import type { ComputedLength } from "../styles/length";

/**
 * Resolve a letter-/word-spacing value to px. `"normal"` ≡ 0. A bare number is
 * already px (UsedStyle, or a flattened ComputedStyle). Percent is invalid for
 * letter/word-spacing and resolves to 0 (defensive — the cascade never emits it).
 */
export function resolveSpacingPx(v: number | "normal" | ComputedLength): number {
  if (v === "normal") return 0;
  if (typeof v === "number") return v;
  return 0; // { unit: "percent" | ... } — not valid here
}

/** v1 word-separator set (CSS Text 3 §8.2 common subset): U+0020, U+00A0. */
export function isWordSeparatorCluster(clusterText: string): boolean {
  return clusterText === " " || clusterText === "\u00A0";
}

/**
 * Extra inline advance for ONE cluster, added to its base (shaper-measured)
 * advance: letter-spacing on every cluster, plus word-spacing on word
 * separators. Both `letterPx`/`wordPx` are pre-resolved (see resolveSpacingPx).
 * Returns 0 when both are 0 (the default — the normal-identity contract).
 */
export function clusterSpacing(clusterText: string, letterPx: number, wordPx: number): number {
  return letterPx + (isWordSeparatorCluster(clusterText) ? wordPx : 0);
}

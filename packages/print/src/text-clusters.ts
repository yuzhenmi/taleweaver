import { graphemeClusters, clusterSpacing } from "@taleweaver/core";

/**
 * Shared grapheme-cluster segmentation for the canvas backend.
 *
 * The canvas shaper (`canvas-shaper.ts`) and the canvas renderer
 * (`canvas-renderer.ts`) MUST segment text identically — the shaper sums
 * per-cluster `measureText` advances into layout/caret/hit-test positions and
 * paint draws each cluster at the SAME cumulative advance; divergence
 * reintroduces per-cluster paint drift. Routing both through this helper (a thin re-export of the
 * core `graphemeClusters`) keeps them in lockstep AND in lockstep with the
 * mock shaper used in unit tests.
 *
 * Segments by UAX #29 grapheme cluster (combining marks, surrogate pairs, ZWJ
 * sequences, regional-indicator flags each become ONE cluster). Glyph METRICS
 * are per-cluster `measureText`; cross-cluster shaping (ligatures, conjuncts)
 * comes from a shaper supplied downstream through `TextShaper`, without
 * changing this contract.
 */
export function segmentClusters(text: string): string[] {
  return graphemeClusters(text);
}

/** U+00AD SOFT HYPHEN. */
const SOFT_HYPHEN = "\u00AD";

/** True for the zero-advance, never-painted soft hyphen cluster. */
export function isSoftHyphen(cluster: string): boolean {
  return cluster === SOFT_HYPHEN;
}

/**
 * Inline advance of one cluster: its canvas-measured width plus CSS Text 3 §8
 * letter-/word-spacing. U+00AD is a zero-advance format character (browser
 * `measureText` often returns a rendered-hyphen width for it), so it advances 0
 * and keeps word widths invariant to embedded soft hyphens. The shaper and every
 * paint loop sum this single rule, so painted glyph origins equal the caret.
 */
export function clusterAdvance(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  cluster: string,
  letterPx: number,
  wordPx: number,
): number {
  if (isSoftHyphen(cluster)) return 0;
  return ctx.measureText(cluster).width + clusterSpacing(cluster, letterPx, wordPx);
}

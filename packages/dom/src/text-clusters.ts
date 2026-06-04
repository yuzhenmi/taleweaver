import { graphemeClusters } from "@taleweaver/core";

/**
 * Shared grapheme-cluster segmentation for the canvas backend.
 *
 * The canvas shaper (`canvas-shaper.ts`) and the canvas renderer
 * (`canvas-renderer.ts`) MUST segment text identically — the shaper sums
 * per-cluster `measureText` advances into layout/caret/hit-test positions and
 * paint draws each cluster at the SAME cumulative advance; divergence
 * reintroduces #330. Routing both through this helper (a thin re-export of the
 * core `graphemeClusters`) keeps them in lockstep AND in lockstep with the
 * mock shaper used in unit tests.
 *
 * Segments by UAX #29 grapheme cluster (combining marks, surrogate pairs, ZWJ
 * sequences, regional-indicator flags each become ONE cluster). Glyph METRICS
 * are still per-cluster `measureText` (no HarfBuzz shaping/ligatures yet) — a
 * real shaping backend will supply true metrics without changing this contract.
 */
export function segmentClusters(text: string): string[] {
  return graphemeClusters(text);
}

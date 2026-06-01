/**
 * Shared grapheme-cluster segmentation for the canvas backend.
 *
 * The canvas shaper (`canvas-shaper.ts`) and the canvas renderer
 * (`canvas-renderer.ts`) MUST segment text identically: the shaper sums
 * per-cluster `measureText` advances into the layout / caret / hit-test
 * positions, and paint draws each cluster at the SAME cumulative advance. Any
 * divergence in segmentation reintroduces the #330 glyph/caret drift (paint
 * kerning the whole run while measurement summed per cluster). Routing both
 * through this helper keeps them in lockstep.
 *
 * v1 segments per UTF-16 code unit — one cluster per `text[i]` — matching the
 * canvas shaper's "each codepoint is one cluster" limitation (no surrogate
 * pairing, no grapheme-cluster combining, no ligatures). A real
 * cluster-shaping backend (HarfBuzz) will replace this with proper grapheme
 * segmentation; updating this one helper updates both consumers at once.
 */
export function segmentClusters(text: string): string[] {
  const clusters: string[] = [];
  for (let i = 0; i < text.length; i++) {
    clusters.push(text[i]);
  }
  return clusters;
}

/**
 * Grapheme-cluster segmentation (UAX #29 extended grapheme clusters) via the
 * platform `Intl.Segmenter`. A single module-level segmenter is reused (it is
 * stateless across `segment()` calls). The shaper's cluster boundaries and the
 * canvas renderer's per-cluster paint both route through this so they can never
 * diverge (the #330 measure-vs-paint drift contract). State offsets remain
 * UTF-16 code units; graphemes are a clustering concept layered over them.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split `text` into its grapheme-cluster substrings, in order. */
export function graphemeClusters(text: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) out.push(seg.segment);
  return out;
}

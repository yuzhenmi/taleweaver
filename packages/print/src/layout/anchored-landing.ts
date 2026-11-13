import type { FloatEnvironment, FragmentainerBounds } from "./float-context";

interface Landing { readonly blockOffset: number; readonly inlineOffset: number }

/**
 * Where a paragraph-anchored float (a wrapped image) lands, in the env frame
 * (cumulative). It stays on its anchor's fragmentainer (R2-3; Word / Google
 * Docs): the request is clamped into `[bounds.top, bounds.end − size]` (taller
 * than the fragmentainer, it starts at the top and overflows). It lands at the
 * request if it fits there over its whole extent; else as low below it as fits
 * on the fragmentainer (CSS 9.5.1 push-below); else at the lowest spot above it
 * that fits — just above a placed float (the request is already at most
 * `bounds.end − size`, so fit can only begin there); with none free, at the
 * request, overlapping (Word's default "allow overlap"). Without bounds it lands
 * as any CSS float.
 */
export function anchoredLanding(
  env: FloatEnvironment,
  side: "inline-start" | "inline-end",
  offsetTop: number,
  inlineSize: number,
  blockSize: number,
  containingInlineSize: number,
  bounds: FragmentainerBounds | undefined,
): Landing {
  if (bounds === undefined) return env.peekPlaceFloat(side, offsetTop, inlineSize, containingInlineSize);
  const requested = Math.max(bounds.top, Math.min(offsetTop, bounds.end - blockSize));
  const floats = env.getPlacedFloats();
  // Fits at `t` over its whole extent.
  const fitsOver = (t: number): Landing | undefined => {
    const { inlineStartSize: start, inlineEndSize: end } = env.availableInlineSizeOver(t, t + blockSize, containingInlineSize);
    if (containingInlineSize - start - end < inlineSize) return undefined;
    return { blockOffset: t, inlineOffset: side === "inline-start" ? start : containingInlineSize - end - inlineSize };
  };
  const below = floats.map((f) => f.blockOffset + f.blockSize).filter((t) => t > requested && t + blockSize <= bounds.end);
  const above = floats.map((f) => f.blockOffset - blockSize).filter((t) => t < requested && t >= bounds.top);
  for (const t of [requested, ...below.sort((a, b) => a - b), ...above.sort((a, b) => b - a)]) {
    const at = fitsOver(t);
    if (at !== undefined) return at;
  }
  return { blockOffset: requested, inlineOffset: side === "inline-start" ? 0 : Math.max(0, containingInlineSize - inlineSize) };
}

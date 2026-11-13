import type { PlacedFloat, PushedFloat } from "./float-context";

/**
 * Field-wise equality of two incoming active-float shadow lists (VL float
 * fast-path). Equal iff same length AND each element agrees on every
 * placement field (`side` / `inlineOffset` / `blockOffset` / `inlineSize` /
 * `blockSize`). A changed upstream float (resized, moved sides, or re-placed at a
 * different offset) flips one of these → the downstream page re-materializes.
 * Compared by value (not reference) since the carry pass builds fresh
 * `PlacedFloat` objects each measure cycle.
 */
export function placedFloatListsEqual(a: readonly PlacedFloat[], b: readonly PlacedFloat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (
      x.side !== y.side ||
      x.inlineOffset !== y.inlineOffset ||
      x.blockOffset !== y.blockOffset ||
      x.inlineSize !== y.inlineSize ||
      x.blockSize !== y.blockSize
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Field-wise equality of two pushed-float lists. Equal iff same length
 * AND each element agrees on its float `node` (reference ===, the cascaded
 * RenderNode) and `side`. A pushed-float carries no geometry (it is re-laid-out
 * on the landing page), so only node identity + side define it. Two empty lists
 * (no-pushed-float docs) compare equal.
 */
export function pushedFloatListsEqual(a: readonly PushedFloat[], b: readonly PushedFloat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.node !== y.node || x.side !== y.side) {
      return false;
    }
  }
  return true;
}

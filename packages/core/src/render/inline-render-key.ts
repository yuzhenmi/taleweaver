import type { BlockId } from "../state";

/** The separator in an inline-atom render key (`${blockId}${INLINE_KEY_SEPARATOR}${i}`). */
export const INLINE_KEY_SEPARATOR = "/inline/";

/**
 * The render key for the i-th inline item of a block — the SINGLE source of truth
 * for the `${blockId}/inline/${i}` format. `i` is the LITERAL array index into the
 * block's `inlineContent.items` (incremented past every item, visible or not), so
 * the render pass, `collectPageFields`, and the a11y projection all key identically.
 */
export function inlineRenderKey(blockId: BlockId, i: number): string {
  return `${blockId}${INLINE_KEY_SEPARATOR}${i}`;
}

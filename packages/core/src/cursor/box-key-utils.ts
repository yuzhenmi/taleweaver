import type { BlockId } from "../state/block-id";

/**
 * Parsed result of a new-renderer inline-item box key.
 *
 * The new renderer keys inline items as `${blockId}/inline/${itemIndex}`
 * (see `render.ts` -> `expandInlineItems`). The IFC may further append
 * `:${runIndex}` when an item is split across multiple text-runs by the
 * line-break pass; both forms parse to the same blockId + itemIndex.
 */
export interface ParsedInlineBoxKey {
  readonly blockId: BlockId;
  readonly itemIndex: number;
}

/**
 * Parse a layout-box key into a `{ blockId, itemIndex }` record, or `null`
 * if the key is not an inline-item box for any block.
 *
 * Accepted forms:
 *   - `${blockId}/inline/${itemIndex}`
 *   - `${blockId}/inline/${itemIndex}:${runIndex}`
 *
 * `runIndex` (when present) is discarded — the same itemIndex spans every
 * fragment produced by the IFC line-break pass.
 */
export function parseInlineBoxKey(key: string): ParsedInlineBoxKey | null {
  const marker = "/inline/";
  const markerIdx = key.lastIndexOf(marker);
  if (markerIdx === -1) return null;
  const blockId = key.slice(0, markerIdx);
  if (blockId.length === 0) return null;
  const tail = key.slice(markerIdx + marker.length);
  // tail is `${itemIndex}` or `${itemIndex}:${runIndex}`.
  const colon = tail.indexOf(":");
  const itemIndexStr = colon === -1 ? tail : tail.slice(0, colon);
  if (itemIndexStr.length === 0) return null;
  const itemIndex = Number.parseInt(itemIndexStr, 10);
  if (!Number.isFinite(itemIndex) || itemIndex < 0) return null;
  return { blockId: blockId as BlockId, itemIndex };
}

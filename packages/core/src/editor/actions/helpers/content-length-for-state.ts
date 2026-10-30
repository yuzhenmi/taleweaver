import { resolveBlock, inlineContentLength } from "../../../state";
import type { BlockId, State } from "../../../state";

/** Content length of a leaf block over a bare `State` (the `objectMoveSelection` variant). */
export function contentLengthForState(state: State, blockId: BlockId): number {
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}

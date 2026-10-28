import { resolveBlock, createPosition, createSpan, inlineContentLength } from "../state";
import type { Position, Span, State } from "../state";

export { blockBefore, blockAfter, type ParagraphNeighbour } from "../state/paragraph-neighbour";
import { blockAfter } from "../state/paragraph-neighbour";

/**
 * Select the paragraph holding `position` INCLUDING its ¶ (triple-click; Word): (P, 0)–(N, 0), N the block after ¶P. At a flow's last paragraph there is no
 * Position after its ¶, so the span is (P, 0)–(P, len). A collapsed span when `position`
 * is not in a text block.
 */
export function selectParagraph(state: State, position: Position): Span {
  const block = resolveBlock(state, position.blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return createSpan(position, position);
  const start = createPosition(block.id, 0);
  const after = blockAfter(state, block);
  return createSpan(start, after === null ? createPosition(block.id, inlineContentLength(block.inlineContent)) : createPosition(after.block.id, 0));
}

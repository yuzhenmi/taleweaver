import { requireBlockText } from "../block-text";
import type { Document, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { Position } from "../block-position";
import { inlineContentLength, type EmbedItem } from "../inline-content";
import { insertInlineItems } from "../y-inline";
import { HARD_BREAK_EMBED_TYPE } from "../hard-break";

/**
 * Insert a soft line break (Word `\v`, Google Docs `\u000b`) at
 * `position`: one inline `hard-break` embed — one offset inside the paragraph, no new
 * ¶ and no paragraph attrs.
 *
 * Throws when the block does not exist, is not a text block, or `position.offset` is
 * out of range.
 */
export function insertLineBreak(state: Document, position: Position): OperationResult {
  const block = resolveBlock(state, position.blockId)?.block ?? null;
  if (block === null) throw new Error(`insertLineBreak: block "${position.blockId}" not found`);
  if (block.inlineContent === null) {
    throw new Error(`insertLineBreak: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }
  const len = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > len) {
    throw new Error(`insertLineBreak: offset ${position.offset} out of range [0, ${len}] for block "${position.blockId}"`);
  }
  const embed: EmbedItem = { kind: "embed", embedType: HARD_BREAK_EMBED_TYPE, attrs: {}, properties: {} };
  return applyOperation(state, (doc) => {
    insertInlineItems(requireBlockText(doc, position.blockId, "insertLineBreak"), position.offset, [embed]);
  });
}

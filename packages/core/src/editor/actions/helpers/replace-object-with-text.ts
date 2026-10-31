import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import { inheritedAttrsAt } from "../../typing-attrs";
import { getBlock, createPosition, createSpan, replaceBlockWithText } from "../../../state";
import type { BlockId, ReadonlyAttrs } from "../../../state";
import { contentLengthForDocument } from "./content-length-for-document";

/**
 * Replace the selected object by `text` (Google Docs: typing over a selected
 * image deletes it and inserts the character at its position). The image is
 * removed AND `text` is inserted into the neighbouring text block in ONE undo
 * entry — via `replaceBlockWithText` (composes `removeBlockInTx` +
 * `insertTextInTx` in a single transaction, mirroring `replaceRange`).
 *
 * Insertion target: the FOLLOWING block's start (preferred), else the PRECEDING
 * block's end. Caret lands AFTER the inserted text. No-op (`null`)
 * when the block is missing OR has no text-bearing sibling to receive the text
 * (an image with only atomic-leaf neighbours — not reachable from the standard
 * insert pipeline, which always trails a paragraph).
 *
 * `text` is the typed run (always non-empty from the typing path); it takes the
 * typing attrs at the landing position (`inheritedAttrsAt`).
 */
export function replaceObjectWithText(
  editor: EditorState,
  objId: BlockId,
  text: string,
): Edit | null {
  if (text === "") return null;
  const obj = getBlock(editor.document, objId);
  if (obj === null) return null;

  const target = textTargetSibling(editor, obj.nextSiblingId, obj.prevSiblingId);
  if (target === null) return null;

  // Typing attributes at the landing caret (pending ones win), like any typing.
  const attrs: ReadonlyAttrs =
    editor.storedAttrs ?? inheritedAttrsAt(editor.document, createPosition(target.blockId, target.offset));
  const result = replaceBlockWithText(
    editor.document,
    objId,
    { blockId: target.blockId, offset: target.offset },
    text,
    attrs,
  );
  if (result.document === editor.document) return null;

  const caret = createPosition(target.blockId, target.offset + text.length);
  return { change: result, selection: createSpan(caret, caret) };
}

/**
 * Resolve the sibling text block + offset to receive the replacement text:
 * the FOLLOWING block's start (preferred), else the PRECEDING block's end. A
 * sibling qualifies only when it is a text-bearing leaf (`inlineContent !== null`)
 * — an atomic-leaf neighbour (another image) cannot receive text. Returns null
 * when neither neighbour qualifies.
 */
function textTargetSibling(
  editor: EditorState,
  nextSiblingId: BlockId | null,
  prevSiblingId: BlockId | null,
): { readonly blockId: BlockId; readonly offset: number } | null {
  if (nextSiblingId !== null && isTextLeaf(editor, nextSiblingId)) {
    return { blockId: nextSiblingId, offset: 0 };
  }
  if (prevSiblingId !== null && isTextLeaf(editor, prevSiblingId)) {
    return { blockId: prevSiblingId, offset: contentLengthForDocument(editor.document, prevSiblingId) };
  }
  return null;
}

function isTextLeaf(editor: EditorState, blockId: BlockId): boolean {
  const block = getBlock(editor.document, blockId);
  return block !== null && block.inlineContent !== null;
}

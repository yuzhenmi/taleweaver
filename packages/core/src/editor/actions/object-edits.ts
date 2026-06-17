import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  resolveBlock,
  createPosition,
  createSpan,
  inlineContentLength,
  productionAllocator,
  deleteTableWithReplacement,
  replaceBlockWithText,
} from "../../state";
import type { BlockId, Position, ReadonlyAttrs, State, Selection } from "../../state";
import { findNextContentBlock, findPrevContentBlock } from "../../cursor/cursor-ops";
import { rebuildTrees } from "./helpers";

/**
 * Shared editor-layer helpers for image OBJECT-SELECTION (#525). An object
 * selection is a COLLAPSED `Selection` on an atomic-leaf block (`{ blockId, 0 }`);
 * `isObjectSelection` returns the selected block id. These three helpers are the
 * surviving-block edits the later guard slices (DELETE / typing / arrow) call:
 *
 *  - `deleteObjectSelection` — remove the object as a unit (Delete/Backspace).
 *  - `replaceObjectWithText` — replace the object by typed text (one undo entry).
 *  - `moveOffObject` — a pure SELECTION move off the object (Arrow keys).
 *
 * All operate on MAIN-TREE atomic-leaf blocks (images / horizontal lines are
 * inserted into the body only — see the INSERT_IMAGE context gate).
 */

/**
 * Content length (cursor positions) of a leaf block, or 0 for a missing /
 * container block. `resolveBlock` so a body-tree neighbour also resolves.
 */
function contentLengthOf(editor: EditorState, blockId: BlockId): number {
  const block = resolveBlock(editor.state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}

/**
 * Delete the selected object as a unit (Google Docs: Backspace/Delete on a
 * selected image removes it). Caret placement after removal:
 *  - the START of the FOLLOWING block, when one exists;
 *  - else the END of the PRECEDING block;
 *  - else (the object was the parent's SOLE child) the start of a fresh empty
 *    paragraph — `deleteTableWithReplacement` (a generic
 *    remove-block-with-replacement primitive) seeds it in the SAME transaction
 *    so the body is never left empty.
 *
 * One undo entry. Undo restores the image AND the object selection (the commit's
 * `before` selection IS the object selection `{ objId, 0 }`). No-op (same
 * `editor` ref) when the block is missing.
 */
export function deleteObjectSelection(
  editor: EditorState,
  config: EditorConfig,
  objId: BlockId,
): EditorState {
  const obj = getBlock(editor.state, objId);
  if (obj === null) return editor;

  // Capture neighbours from the PRE-mutation snapshot — they survive the removal
  // (their sibling pointers are relinked, ids unchanged) and drive caret choice.
  const nextSiblingId = obj.nextSiblingId;
  const prevSiblingId = obj.prevSiblingId;

  const result = deleteTableWithReplacement(editor.state, objId, productionAllocator);
  if (result.state === editor.state) return editor;

  const caret = caretAfterObjectDelete(
    editor,
    nextSiblingId,
    prevSiblingId,
    result.newParagraphId,
  );
  if (caret === null) return editor; // unreachable: seed paragraph OR a sibling exists

  const newSelection = createSpan(caret, caret);
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: newSelection },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * Resolve the post-delete caret: following-block start, else preceding-block end,
 * else the seeded paragraph's start. The preceding block's content length is read
 * from the ORIGINAL `editor` state — removing a sibling does not touch the
 * preceding block's `inlineContent`, so its length is identical pre/post-delete.
 */
function caretAfterObjectDelete(
  editor: EditorState,
  nextSiblingId: BlockId | null,
  prevSiblingId: BlockId | null,
  seededParagraphId: BlockId | null,
): Position | null {
  if (nextSiblingId !== null) {
    return createPosition(nextSiblingId, 0);
  }
  if (prevSiblingId !== null) {
    return createPosition(prevSiblingId, contentLengthOf(editor, prevSiblingId));
  }
  if (seededParagraphId !== null) {
    return createPosition(seededParagraphId, 0);
  }
  return null;
}

/**
 * Replace the selected object by `text` (Google Docs: typing over a selected
 * image deletes it and inserts the character at its position). The image is
 * removed AND `text` is inserted into the neighbouring text block in ONE undo
 * entry — via `replaceBlockWithText` (composes `removeBlockInTx` +
 * `insertTextInTx` in a single transaction, mirroring `replaceRange`).
 *
 * Insertion target: the FOLLOWING block's start (preferred), else the PRECEDING
 * block's end. Caret lands AFTER the inserted text. No-op (same `editor` ref)
 * when the block is missing OR has no text-bearing sibling to receive the text
 * (an image with only atomic-leaf neighbours — not reachable from the standard
 * insert pipeline, which always trails a paragraph).
 *
 * `text` is the typed run (always non-empty from the typing path); attrs are
 * taken from the insert target's surrounding run by `insertText`'s planner.
 */
export function replaceObjectWithText(
  editor: EditorState,
  config: EditorConfig,
  objId: BlockId,
  text: string,
): EditorState {
  if (text === "") return editor;
  const obj = getBlock(editor.state, objId);
  if (obj === null) return editor;

  const target = textTargetSibling(editor, obj.nextSiblingId, obj.prevSiblingId);
  if (target === null) return editor;

  const attrs: ReadonlyAttrs = {};
  const result = replaceBlockWithText(
    editor.state,
    objId,
    { blockId: target.blockId, offset: target.offset },
    text,
    attrs,
    config.attrRegistry,
  );
  if (result.state === editor.state) return editor;

  const caret = createPosition(target.blockId, target.offset + text.length);
  const newSelection = createSpan(caret, caret);
  editor.history.commit(result, { before: editor.selection, after: newSelection });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
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
    return { blockId: prevSiblingId, offset: contentLengthOf(editor, prevSiblingId) };
  }
  return null;
}

function isTextLeaf(editor: EditorState, blockId: BlockId): boolean {
  const block = getBlock(editor.state, blockId);
  return block !== null && block.inlineContent !== null;
}

/**
 * Move the caret OFF the selected object (Arrow keys on a selected image place
 * the caret beside it, Google Docs). PURE selection move — no `history.commit`,
 * no block mutation:
 *  - `"forward"` → caret at the START of the next inline-bearing block;
 *  - `"backward"` → caret at the END of the previous inline-bearing block.
 *
 * When there is no neighbour in that direction (document edge), the caret stays
 * on the object (returns `editor` unchanged) rather than crashing. No
 * `rebuildTrees` (no block dirtied) — mirrors `handleMoveCursor`'s selection-only
 * return shape.
 */
export function moveOffObject(
  editor: EditorState,
  objId: BlockId,
  direction: "forward" | "backward",
): EditorState {
  const selection = objectMoveSelection(editor.state, objId, direction);
  return selection === null ? editor : { ...editor, selection };
}

/**
 * The PURE selection a `moveOffObject` resolves to — the collapsed caret BESIDE
 * the object (forward → start of the next content block; backward → end of the
 * previous one), or `null` at the document edge (no neighbour). Factored out of
 * `moveOffObject` so the print backend's NavIntent resolver (which owns the
 * geometric ArrowLeft/Right/Up/Down handlers post-Phase-0b) computes the IDENTICAL
 * object-nav selection without an `EditorState`, then dispatches it as a
 * `SET_SELECTION`. Takes a bare `State` (not `EditorState`) so it is reusable
 * across the seam.
 */
export function objectMoveSelection(
  state: State,
  objId: BlockId,
  direction: "forward" | "backward",
): Selection | null {
  if (direction === "forward") {
    const nextId = findNextContentBlock(state, objId);
    if (nextId === null) return null;
    const caret = createPosition(nextId, 0);
    return createSpan(caret, caret);
  }
  const prevId = findPrevContentBlock(state, objId);
  if (prevId === null) return null;
  const caret = createPosition(prevId, contentLengthForState(state, prevId));
  return createSpan(caret, caret);
}

/** Content length of a leaf block over a bare `State` (the `objectMoveSelection` variant). */
function contentLengthForState(state: State, blockId: BlockId): number {
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}

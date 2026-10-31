import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { resolveBlock, getBlock, spanStart, clipSpanToText, removeBlock, lastLeafBlock, createPosition, createSpan, mergeAdjacentBlocks, deleteSectionBreak, inlineContentLength } from "../../state";
import type { Block } from "../../state";
import { caretEdit } from "./helpers/caret-edit";
import { suggestMarkDeletion } from "./helpers/suggest-mark-deletion";
import { blockBefore } from "../../cursor/paragraph-mark";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { shiftListLevel } from "./helpers/shift-list-level";
import { listLevelOf } from "./helpers/list-level-of";
import { unlistBlock } from "./helpers/unlist-block";
import { deleteAdjacentAtomicLeaf } from "./helpers/delete-adjacent-atomic-leaf";
import { deleteObjectSelection } from "./helpers/delete-object-selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest } from "./helpers/delete-range-or-suggest";
import { suggestionInputForBlock } from "./helpers/suggestion-input-for-block";
import { isSuggestingInBlock } from "./helpers/is-suggesting-in-block";

export function handleDeleteBackward(editor: EditorState): Edit | null {
  const { config } = editor;
  const { selection } = editor;

  // Object selection: remove the selected image as a unit — a hard `removeBlock`
  // in BOTH direct and suggesting mode (matching deleteAdjacentAtomicLeaf, which
  // has no suggesting branch — whole-block deletion-as-suggestion does not exist
  // for any atomic block; a pre-existing change-tracking gap, not specific to object deletion).
  const objId = isObjectSelection(editor.document, selection, config.componentRegistry);
  if (objId !== null) return deleteObjectSelection(editor, objId);

  // Non-collapsed: delete range. Cursor goes to spanStart.
  if (!isCollapsed(selection)) {
    // Cross-CONTEXT selection refusal (see isCrossContextSelection).
    if (isCrossContextSelection(editor.document, selection)) return null;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.document, selection);
    if (start === null) return null;
    const result = deleteRangeOrSuggest(editor, selection);
    // A suggesting soft-delete keeps the text (struck): the caret goes to the start of
    // the span's text (a covered object stays — `clipSpanToText`).
    const at = isSuggestingInBlock(editor, spanStart(editor.document, selection).blockId)
      ? clipSpanToText(editor.document, selection).anchor
      : start;
    const newCursor = createPosition(at.blockId, at.offset);
    const newSelection = createSpan(newCursor, newCursor);
    // Suggesting mode over an already-struck selection: a caret-only outcome.
    if (result.state === editor.document) return { selection: newSelection };
    return { change: result, selection: newSelection };
  }

  const pos = selection.focus;

  // Mid-block: delete one grapheme cluster going backward. Only markers before the
  // caret (not caret stops) → `prev` is in the previous block: the ¶ path below.
  const prev = pos.offset > 0 ? moveByCharacter(editor.document, pos, "backward") : null;
  if (prev !== null && prev.blockId === pos.blockId) {
    if (prev.offset === pos.offset) return null;
    // A character of an atomic mark deletes the whole mark.
    const span = expandSpanOverAtomicMarks(editor.document, createSpan(prev, pos));
    const result = deleteRangeOrSuggest(editor, span);
    const newCursor = createPosition(span.anchor.blockId, span.anchor.offset);
    const newSelection = createSpan(newCursor, newCursor);
    // Suggesting mode over an already-struck character (any author): nothing is
    // written; the caret moves across it (no history entry).
    if (result.state === editor.document) return { selection: newSelection };
    return { change: result, selection: newSelection };
  }

  // The caret is at the block's first caret position: cross-block backspace.
  const currentBlock = resolveBlock(editor.document, pos.blockId)?.block ?? null;
  if (currentBlock === null) return null;

  // Backspace at the START of a list-item (Google Docs): a nested item (level>0)
  // outdents one level; a top-level item (level 0) drops its list formatting and
  // becomes a plain paragraph — rather than merging into the previous block.
  if (currentBlock.type === "list-item") {
    return listLevelOf(currentBlock) > 0
      ? shiftListLevel(editor, -1)
      : unlistBlock(editor, currentBlock);
  }

  // Backspace at (N, 0) removes the ¶ before N — the unit
  // before N's first caret position (its previous sibling's ¶, or across a doc-root
  // section boundary the previous section's section-end item).
  const before = blockBefore(editor.document, currentBlock);
  if (before === null) return null; // a flow's first caret position: no-op
  const prevBlock = before.block;
  const prevLen = prevBlock.inlineContent === null ? 0 : inlineContentLength(prevBlock.inlineContent);

  // Section break (Word): one step — the paragraphs merge (survivor N) and the
  // sections merge. A header / footnote body has no doc-root sections, so this never
  // fires there.
  if (before.sectionBreak !== null) {
    // Suggesting mode FIRST: a tracked deletion of the section-end ¶ (Word tracks a
    // deleted section break) instead of the real merge.
    const sectionInput = suggestionInputForBlock(editor, currentBlock.id);
    if (sectionInput !== null) return suggestMarkDeletion(editor, prevBlock, sectionInput, createPosition(prevBlock.id, prevLen));
    const result = deleteSectionBreak(editor.document, before.sectionBreak);
    if (result.state === editor.document) return null;
    return caretEdit(result, createPosition(currentBlock.id, prevLen));
  }

  // An atomic object before N (image / horizontal-line): delete it as a unit.
  if (config.componentRegistry.getBlockKind(prevBlock.type) === "atomic-leaf") {
    return deleteAdjacentAtomicLeaf(editor, currentBlock, "backward", pos);
  }

  // A table / host container before N (Word): text never merges into it. A
  // NON-empty N stays (no-op); an EMPTY N is removed through `deleteUnits` (a ¶ that
  // invariant I needs stays) and the caret goes to the end of the last cell.
  if (prevBlock.inlineContent === null) {
    if (currentLen(currentBlock) > 0) return null;
    // Suggesting mode: a tracked deletion of the empty paragraph's own ¶ —
    // keyed only when accepting would remove it (invariant I); the caret stays.
    const ownInput = suggestionInputForBlock(editor, currentBlock.id);
    if (ownInput !== null) return suggestMarkDeletion(editor, currentBlock, ownInput, pos);
    const result = removeBlock(editor.document, currentBlock.id);
    if (result.state === editor.document || resolveBlock(result.state, currentBlock.id) !== null) return null;
    const lastId = lastLeafBlock(result.state, prevBlock.id);
    const last = lastId === null ? null : getBlock(result.state, lastId);
    if (last === null || last.inlineContent === null) return null;
    return caretEdit(result, createPosition(last.id, inlineContentLength(last.inlineContent)));
  }

  // Suggesting mode: a tracked deletion of ¶prev (`deletionSuggestionId` on prev's
  // ¶) instead of really merging — in ANY editing context (main body or a
  // footnote / header / footer body). Blocks stay separate; the caret stays at N:0.
  const joinInput = suggestionInputForBlock(editor, currentBlock.id);
  if (joinInput !== null) return suggestMarkDeletion(editor, prevBlock, joinInput, createPosition(prevBlock.id, prevLen));

  // Delete ¶prev: the right paragraph N survives holding [...prev, ...N];
  // the caret sits at the seam.
  const result = mergeAdjacentBlocks(editor.document, prevBlock.id, currentBlock.id);
  if (result.state === editor.document) return null;
  return caretEdit(result, createPosition(result.survivorId, prevLen));
}

function currentLen(b: Block): number {
  return b.inlineContent === null ? 0 : inlineContentLength(b.inlineContent);
}

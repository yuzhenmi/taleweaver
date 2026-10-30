import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { resolveBlock, getBlock, spanStart, removeBlock, lastLeafBlock, createPosition, createSpan, mergeAdjacentBlocks, deleteSectionBreak, inlineContentLength } from "../../state";
import type { Block } from "../../state";
import { commitWithCaret, suggestMarkDeletion } from "./paragraph-mark-delete";
import { blockBefore } from "../../cursor/paragraph-mark";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { handleListIndent } from "./list-indent";
import { listLevelOf, unlistBlock } from "./list-edits";
import { deleteAdjacentAtomicLeaf } from "./atomic-edits";
import { deleteObjectSelection } from "./object-edits";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest, suggestionInputForBlock, isSuggestingInBlock } from "./suggestion-mode";
import { handleSetSelection } from "./set-selection";

export function handleDeleteBackward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // Object selection: remove the selected image as a unit — a hard `removeBlock`
  // in BOTH direct and suggesting mode (matching deleteAdjacentAtomicLeaf, which
  // has no suggesting branch — whole-block deletion-as-suggestion does not exist
  // for any atomic block; a pre-existing change-tracking gap, not specific to object deletion).
  const objId = isObjectSelection(editor.state, selection, config.componentRegistry);
  if (objId !== null) return deleteObjectSelection(editor, config, objId);

  // Non-collapsed: delete range. Cursor goes to spanStart.
  if (!isCollapsed(selection)) {
    // Cross-CONTEXT selection refusal (see isCrossContextSelection).
    if (isCrossContextSelection(editor.state, selection)) return editor;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
    const result = deleteRangeOrSuggest(editor.state, selection, config);
    // A suggesting soft-delete keeps the text (struck): the caret goes to the span start.
    const at = isSuggestingInBlock(editor.state, spanStart(editor.state, selection).blockId, config)
      ? spanStart(editor.state, selection)
      : start;
    const newCursor = createPosition(at.blockId, at.offset);
    const newSelection = createSpan(newCursor, newCursor);
    // Suggesting mode over an already-struck selection: a caret-only outcome.
    if (result.state === editor.state) return handleSetSelection(editor, newSelection);
    editor.history.commit(result, {
      before: selection,
      after: newSelection,
    });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
  }

  const pos = selection.focus;

  // Mid-block: delete one grapheme cluster going backward. Only markers before the
  // caret (not caret stops) → `prev` is in the previous block: the ¶ path below.
  const prev = pos.offset > 0 ? moveByCharacter(editor.state, pos, "backward") : null;
  if (prev !== null && prev.blockId === pos.blockId) {
    if (prev.offset === pos.offset) return editor;
    // A character of an atomic mark deletes the whole mark.
    const span = expandSpanOverAtomicMarks(editor.state, createSpan(prev, pos));
    const result = deleteRangeOrSuggest(editor.state, span, config);
    const newCursor = createPosition(span.anchor.blockId, span.anchor.offset);
    const newSelection = createSpan(newCursor, newCursor);
    // Suggesting mode over an already-struck character (any author): nothing is
    // written; the caret moves across it (no history entry).
    if (result.state === editor.state) return handleSetSelection(editor, newSelection);
    editor.history.commit(result, {
      before: selection,
      after: newSelection,
    });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
  }

  // The caret is at the block's first caret position: cross-block backspace.
  const currentBlock = resolveBlock(editor.state, pos.blockId)?.block ?? null;
  if (currentBlock === null) return editor;

  // Backspace at the START of a list-item (Google Docs): a nested item (level>0)
  // outdents one level; a top-level item (level 0) drops its list formatting and
  // becomes a plain paragraph — rather than merging into the previous block.
  if (currentBlock.type === "list-item") {
    return listLevelOf(currentBlock) > 0
      ? handleListIndent(editor, -1, config)
      : unlistBlock(editor, currentBlock, config);
  }

  // Backspace at (N, 0) removes the ¶ before N — the unit
  // before N's first caret position (its previous sibling's ¶, or across a doc-root
  // section boundary the previous section's section-end item).
  const before = blockBefore(editor.state, currentBlock);
  if (before === null) return editor; // a flow's first caret position: no-op
  const prevBlock = before.block;
  const prevLen = prevBlock.inlineContent === null ? 0 : inlineContentLength(prevBlock.inlineContent);

  // Section break (Word): one step — the paragraphs merge (survivor N) and the
  // sections merge. A header / footnote body has no doc-root sections, so this never
  // fires there.
  if (before.sectionBreak !== null) {
    // Suggesting mode FIRST: a tracked deletion of the section-end ¶ (Word tracks a
    // deleted section break) instead of the real merge.
    const sectionInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
    if (sectionInput !== null) return suggestMarkDeletion(editor, config, prevBlock, sectionInput, createPosition(prevBlock.id, prevLen));
    const result = deleteSectionBreak(editor.state, before.sectionBreak);
    if (result.state === editor.state) return editor;
    return commitWithCaret(editor, config, result, createPosition(currentBlock.id, prevLen));
  }

  // An atomic object before N (image / horizontal-line): delete it as a unit.
  if (config.componentRegistry.getBlockKind(prevBlock.type) === "atomic-leaf") {
    return deleteAdjacentAtomicLeaf(editor, config, currentBlock, "backward", pos) ?? editor;
  }

  // A table / host container before N (Word): text never merges into it. A
  // NON-empty N stays (no-op); an EMPTY N is removed through `deleteUnits` (a ¶ that
  // invariant I needs stays) and the caret goes to the end of the last cell.
  if (prevBlock.inlineContent === null) {
    if (currentLen(currentBlock) > 0) return editor;
    // Suggesting mode: a tracked deletion of the empty paragraph's own ¶ —
    // keyed only when accepting would remove it (invariant I); the caret stays.
    const ownInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
    if (ownInput !== null) return suggestMarkDeletion(editor, config, currentBlock, ownInput, pos);
    const result = removeBlock(editor.state, currentBlock.id);
    if (result.state === editor.state || resolveBlock(result.state, currentBlock.id) !== null) return editor;
    const lastId = lastLeafBlock(result.state, prevBlock.id);
    const last = lastId === null ? null : getBlock(result.state, lastId);
    if (last === null || last.inlineContent === null) return editor;
    return commitWithCaret(editor, config, result, createPosition(last.id, inlineContentLength(last.inlineContent)));
  }

  // Suggesting mode: a tracked deletion of ¶prev (`deletionSuggestionId` on prev's
  // ¶) instead of really merging — in ANY editing context (main body or a
  // footnote / header / footer body). Blocks stay separate; the caret stays at N:0.
  const joinInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
  if (joinInput !== null) return suggestMarkDeletion(editor, config, prevBlock, joinInput, createPosition(prevBlock.id, prevLen));

  // Delete ¶prev: the right paragraph N survives holding [...prev, ...N];
  // the caret sits at the seam.
  const result = mergeAdjacentBlocks(editor.state, prevBlock.id, currentBlock.id);
  if (result.state === editor.state) return editor;
  return commitWithCaret(editor, config, result, createPosition(result.survivorId, prevLen));
}

function currentLen(b: Block): number {
  return b.inlineContent === null ? 0 : inlineContentLength(b.inlineContent);
}

import type { EditorState, EditorConfig } from "../editor-state";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { resolveBlock, getBlock, removeBlock, firstLeafBlock, createPosition, createSpan, spanStart, spanEnd, mergeAdjacentBlocks, deleteSectionBreak, inlineContentLength } from "../../state";
import { commitWithCaret, suggestMarkDeletion } from "./paragraph-mark-delete";
import { blockAfter } from "../../cursor/paragraph-mark";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { deleteAdjacentAtomicLeaf } from "./atomic-edits";
import { deleteObjectSelection } from "./object-edits";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest, suggestionInputForBlock, isSuggestingInBlock } from "./suggestion-mode";
import { handleSetSelection } from "./set-selection";

export function handleDeleteForward(
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
    // Suggesting mode over an already-struck selection: a caret-only outcome (span end).
    if (result.state === editor.state) {
      const end = spanEnd(editor.state, selection);
      return handleSetSelection(editor, createSpan(end, end));
    }
    // Forward soft-delete leaves the struck text in place, so the caret must
    // land PAST it (span END); a direct delete removes the text, so the caret
    // stays at the span start. (Backward soft-delete uses the span start.)
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck text,
    // so the caret advances to span END; only when there is no valid context does
    // it become a direct delete with the caret at span start.
    const suggesting = isSuggestingInBlock(
      editor.state,
      spanStart(editor.state, selection).blockId,
      config,
    );
    const collapseTo = suggesting ? spanEnd(editor.state, selection) : start;
    const newCursor = createPosition(collapseTo.blockId, collapseTo.offset);
    const newSelection = createSpan(newCursor, newCursor);
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
  const currentBlock = resolveBlock(editor.state, pos.blockId)?.block ?? null;
  if (currentBlock === null) return editor;
  const currentLen =
    currentBlock.inlineContent === null
      ? 0
      : inlineContentLength(currentBlock.inlineContent);

  // Mid-block: delete one grapheme cluster going forward. Only markers after the
  // caret (not caret stops) → `next` is in the next block: the ¶ path below.
  const next = pos.offset < currentLen ? moveByCharacter(editor.state, pos, "forward") : null;
  if (next !== null && next.blockId === pos.blockId) {
    if (next.offset === pos.offset) return editor;
    // A character of an atomic mark deletes the whole mark.
    const span = expandSpanOverAtomicMarks(editor.state, createSpan(pos, next));
    const result = deleteRangeOrSuggest(editor.state, span, config);
    // Suggesting mode over an already-struck character (any author): nothing is
    // written; the caret moves past it (no history entry).
    if (result.state === editor.state) return handleSetSelection(editor, createSpan(span.focus, span.focus));
    // Forward soft-delete strikes the char in place, so the caret must ADVANCE
    // past it (to `next`, the span end) — else the next Delete would re-target
    // the already-struck char (markDeletion coalesces → no-op). A direct delete
    // removes the char, so the caret stays at `pos` (content shrank).
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck char,
    // so the caret advances to `next`; only with no valid context is it a direct
    // delete with the caret at `pos`.
    const suggesting = isSuggestingInBlock(
      editor.state,
      spanStart(editor.state, span).blockId,
      config,
    );
    const newCursor = suggesting
      ? createPosition(span.focus.blockId, span.focus.offset)
      : createPosition(span.anchor.blockId, span.anchor.offset);
    const newSelection = createSpan(newCursor, newCursor);
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

  // Delete at (P, len) removes ¶P — the unit between P and the
  // block after it (its next sibling, or across a doc-root section boundary the next
  // section's first block: ¶P is then the section-end item). At a flow's final ¶: no-op.
  const after = blockAfter(editor.state, currentBlock);
  if (after === null) return editor;
  const nextBlock = after.block;

  if (nextBlock.inlineContent === null && after.sectionBreak === null) {
    const atomic = config.componentRegistry.getBlockKind(nextBlock.type) === "atomic-leaf";
    // A NON-empty paragraph before an object: an atomic object (image / rule) is
    // deleted as a unit; text never merges into a
    // table / host container (Word) — no-op.
    if (currentLen > 0) {
      return atomic ? (deleteAdjacentAtomicLeaf(editor, config, currentBlock, "forward", pos) ?? editor) : editor;
    }
    // An EMPTY paragraph before an object is removed through `deleteUnits` (a ¶ that
    // invariant I needs stays). The caret goes to the table's / container's first
    // caret position, or selects the atomic object (collapsed (obj, 0), select-first).
    // Suggesting mode: a tracked deletion of the empty paragraph's ¶ — keyed
    // only when accepting would remove it (invariant I); the caret stays.
    const ownInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
    if (ownInput !== null) return suggestMarkDeletion(editor, config, currentBlock, ownInput, pos);
    const result = removeBlock(editor.state, currentBlock.id);
    if (result.state === editor.state || resolveBlock(result.state, currentBlock.id) !== null) return editor;
    const target = atomic ? nextBlock.id : firstLeafBlock(result.state, nextBlock.id);
    if (target === null) return editor;
    return commitWithCaret(editor, config, result, createPosition(target, 0));
  }

  // Section break (Word): ¶P is the section-end item — one step: the paragraphs merge
  // (survivor = the next section's first paragraph) and the sections merge.
  if (after.sectionBreak !== null) {
    // Suggesting mode FIRST: a tracked deletion of the section-end ¶ (Word tracks a
    // deleted section break) instead of the real merge.
    const sectionInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
    if (sectionInput !== null) return suggestMarkDeletion(editor, config, currentBlock, sectionInput, createPosition(nextBlock.id, 0));
    const result = deleteSectionBreak(editor.state, after.sectionBreak);
    if (result.state === editor.state) return editor;
    // P merged into the next paragraph (survivor R): the caret sits at the seam there.
    // When ¶P stayed (invariant I) P keeps the caret.
    const caret =
      getBlock(result.state, currentBlock.id) !== null
        ? pos
        : nextBlock.inlineContent === null
          ? createPosition(nextBlock.id, 0)
          : createPosition(nextBlock.id, currentLen);
    return commitWithCaret(editor, config, result, caret);
  }

  // Suggesting mode: a tracked deletion of ¶P (`deletionSuggestionId` on P's ¶)
  // instead of really merging — in ANY editing context. Blocks stay separate;
  // the caret stays at P's end.
  const joinInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
  if (joinInput !== null) return suggestMarkDeletion(editor, config, currentBlock, joinInput, createPosition(nextBlock.id, 0));

  // Delete ¶P: the right paragraph survives holding [...P, ...next]; the
  // caret sits at the seam.
  const result = mergeAdjacentBlocks(editor.state, currentBlock.id, nextBlock.id);
  if (result.state === editor.state) return editor;
  return commitWithCaret(editor, config, result, createPosition(result.survivorId, currentLen));
}

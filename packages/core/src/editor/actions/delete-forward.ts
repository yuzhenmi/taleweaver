import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { resolveBlock, getBlock, removeBlock, firstLeafBlock, createPosition, createSpan, spanStart, clipSpanToText, mergeAdjacentBlocks, deleteSectionBreak, inlineContentLength } from "../../state";
import { caretEdit } from "./helpers/caret-edit";
import { suggestMarkDeletion } from "./helpers/suggest-mark-deletion";
import { blockAfter } from "../../cursor/paragraph-mark";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { deleteAdjacentAtomicLeaf } from "./helpers/delete-adjacent-atomic-leaf";
import { deleteObjectSelection } from "./helpers/delete-object-selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest } from "./helpers/delete-range-or-suggest";
import { suggestionInputForBlock } from "./helpers/suggestion-input-for-block";
import { isSuggestingInBlock } from "./helpers/is-suggesting-in-block";

export function handleDeleteForward(editor: EditorState): Edit | null {
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
    // Suggesting mode over an already-struck selection: a caret-only outcome (span end).
    if (result.state === editor.document) {
      const end = clipSpanToText(editor.document, selection).focus;
      return { selection: createSpan(end, end) };
    }
    // Forward soft-delete leaves the struck text in place, so the caret must
    // land PAST it (span END); a direct delete removes the text, so the caret
    // stays at the span start. (Backward soft-delete uses the span start.)
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck text,
    // so the caret advances to span END; only when there is no valid context does
    // it become a direct delete with the caret at span start.
    const suggesting = isSuggestingInBlock(
      editor,
      spanStart(editor.document, selection).blockId,
    );
    // (The span's text end: a covered object stays — `clipSpanToText`.)
    const collapseTo = suggesting ? clipSpanToText(editor.document, selection).focus : start;
    const newCursor = createPosition(collapseTo.blockId, collapseTo.offset);
    const newSelection = createSpan(newCursor, newCursor);
    return { change: result, selection: newSelection };
  }

  const pos = selection.focus;
  const currentBlock = resolveBlock(editor.document, pos.blockId)?.block ?? null;
  if (currentBlock === null) return null;
  const currentLen =
    currentBlock.inlineContent === null
      ? 0
      : inlineContentLength(currentBlock.inlineContent);

  // Mid-block: delete one grapheme cluster going forward. Only markers after the
  // caret (not caret stops) → `next` is in the next block: the ¶ path below.
  const next = pos.offset < currentLen ? moveByCharacter(editor.document, pos, "forward") : null;
  if (next !== null && next.blockId === pos.blockId) {
    if (next.offset === pos.offset) return null;
    // A character of an atomic mark deletes the whole mark.
    const span = expandSpanOverAtomicMarks(editor.document, createSpan(pos, next));
    const result = deleteRangeOrSuggest(editor, span);
    // Suggesting mode over an already-struck character (any author): nothing is
    // written; the caret moves past it (no history entry).
    if (result.state === editor.document) return { selection: createSpan(span.focus, span.focus) };
    // Forward soft-delete strikes the char in place, so the caret must ADVANCE
    // past it (to `next`, the span end) — else the next Delete would re-target
    // the already-struck char (markDeletion coalesces → no-op). A direct delete
    // removes the char, so the caret stays at `pos` (content shrank).
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck char,
    // so the caret advances to `next`; only with no valid context is it a direct
    // delete with the caret at `pos`.
    const suggesting = isSuggestingInBlock(
      editor,
      spanStart(editor.document, span).blockId,
    );
    const newCursor = suggesting
      ? createPosition(span.focus.blockId, span.focus.offset)
      : createPosition(span.anchor.blockId, span.anchor.offset);
    const newSelection = createSpan(newCursor, newCursor);
    return { change: result, selection: newSelection };
  }

  // Delete at (P, len) removes ¶P — the unit between P and the
  // block after it (its next sibling, or across a doc-root section boundary the next
  // section's first block: ¶P is then the section-end item). At a flow's final ¶: no-op.
  const after = blockAfter(editor.document, currentBlock);
  if (after === null) return null;
  const nextBlock = after.block;

  if (nextBlock.inlineContent === null && after.sectionBreak === null) {
    const atomic = config.componentRegistry.getBlockKind(nextBlock.type) === "atomic-leaf";
    // A NON-empty paragraph before an object: an atomic object (image / rule) is
    // deleted as a unit; text never merges into a
    // table / host container (Word) — no-op.
    if (currentLen > 0) {
      return atomic ? deleteAdjacentAtomicLeaf(editor, currentBlock, "forward", pos) : null;
    }
    // An EMPTY paragraph before an object is removed through `deleteUnits` (a ¶ that
    // invariant I needs stays). The caret goes to the table's / container's first
    // caret position, or selects the atomic object (collapsed (obj, 0), select-first).
    // Suggesting mode: a tracked deletion of the empty paragraph's ¶ — keyed
    // only when accepting would remove it (invariant I); the caret stays.
    const ownInput = suggestionInputForBlock(editor, currentBlock.id);
    if (ownInput !== null) return suggestMarkDeletion(editor, currentBlock, ownInput, pos);
    const result = removeBlock(editor.document, currentBlock.id);
    if (result.state === editor.document || resolveBlock(result.state, currentBlock.id) !== null) return null;
    const target = atomic ? nextBlock.id : firstLeafBlock(result.state, nextBlock.id);
    if (target === null) return null;
    return caretEdit(result, createPosition(target, 0));
  }

  // Section break (Word): ¶P is the section-end item — one step: the paragraphs merge
  // (survivor = the next section's first paragraph) and the sections merge.
  if (after.sectionBreak !== null) {
    // Suggesting mode FIRST: a tracked deletion of the section-end ¶ (Word tracks a
    // deleted section break) instead of the real merge.
    const sectionInput = suggestionInputForBlock(editor, currentBlock.id);
    if (sectionInput !== null) return suggestMarkDeletion(editor, currentBlock, sectionInput, createPosition(nextBlock.id, 0));
    const result = deleteSectionBreak(editor.document, after.sectionBreak);
    if (result.state === editor.document) return null;
    // P merged into the next paragraph (survivor R): the caret sits at the seam there.
    // When ¶P stayed (invariant I) P keeps the caret.
    const caret =
      getBlock(result.state, currentBlock.id) !== null
        ? pos
        : nextBlock.inlineContent === null
          ? createPosition(nextBlock.id, 0)
          : createPosition(nextBlock.id, currentLen);
    return caretEdit(result, caret);
  }

  // Suggesting mode: a tracked deletion of ¶P (`deletionSuggestionId` on P's ¶)
  // instead of really merging — in ANY editing context. Blocks stay separate;
  // the caret stays at P's end.
  const joinInput = suggestionInputForBlock(editor, currentBlock.id);
  if (joinInput !== null) return suggestMarkDeletion(editor, currentBlock, joinInput, createPosition(nextBlock.id, 0));

  // Delete ¶P: the right paragraph survives holding [...P, ...next]; the
  // caret sits at the seam.
  const result = mergeAdjacentBlocks(editor.document, currentBlock.id, nextBlock.id);
  if (result.state === editor.document) return null;
  return caretEdit(result, createPosition(result.survivorId, currentLen));
}

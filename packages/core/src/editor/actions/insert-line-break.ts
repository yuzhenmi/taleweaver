import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { insertLineBreak, mintLineBreak, markDeletion, deleteRange, createPosition, createSpan, spanStart, spanEnd, clipSpanToText, resolveBlock } from "../../state";
import type { BlockId, OperationResult, Position, State, ReplaceSuggestionInput } from "../../state";
import { blockAfter } from "../../cursor/paragraph-mark";
import { isCollapsed } from "../../cursor/selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { replaceSuggestionInputForBlock } from "./helpers/replace-suggestion-input-for-block";
import { caretEdit } from "./helpers/caret-edit";

/**
 * `INSERT_LINE_BREAK` (Shift+Enter): insert a soft line break — an
 * inline `hard-break` embed (Word `\v`, Google Docs `\u000b`) — at the caret,
 * replacing a selection (deleted, or struck in suggesting mode) as ONE undo step. No
 * new ¶ and no paragraph attrs. The caret lands just after the break.
 *
 * In suggesting mode the break is an inline insertion revision (`mintLineBreak`), and
 * a selection is struck (not deleted). No-op (same editor) for a cross-context /
 * un-deletable selection.
 */
export function handleInsertLineBreak(editor: EditorState): Edit | null {
  const { selection } = editor;
  const input = replaceSuggestionInputForBlock(editor, spanStart(editor.state, selection).blockId);
  if (input !== null) return suggestLineBreak(editor, input);
  let state: State = editor.state;
  let at = selection.focus;
  const dirtyIds = new Set<BlockId>();
  if (!isCollapsed(selection)) {
    if (isCrossContextSelection(state, selection)) return null;
    const start = expandedSpanCollapsePoint(state, selection);
    if (start === null) return null;
    const r = deleteRange(state, selection);
    state = r.state;
    for (const id of r.dirtyIds) dirtyIds.add(id);
    at = start;
  }
  const r = insertLineBreak(state, at);
  for (const id of r.dirtyIds) dirtyIds.add(id);
  const result: OperationResult = { state: r.state, dirtyIds };
  return caretEdit(result, createPosition(at.blockId, at.offset + 1));
}

/**
 * Suggesting-mode Shift+Enter: the break goes in at the selection start FIRST (so no
 * strike can rename that block), then the selection — shifted past the break when it
 * ends in the same block — is struck (`markDeletion`), as ONE undo step. When the
 * strike removed the start block's own pending ¶ (the merge keeps the start block's
 * content at the front of the paragraph after it), the caret follows to that survivor.
 */
function suggestLineBreak(editor: EditorState, input: ReplaceSuggestionInput): Edit | null {
  const { selection } = editor;
  if (!isCollapsed(selection) && isCrossContextSelection(editor.state, selection)) return null;
  // The break goes at the start of the span's TEXT (after an object start — a covered
  // object stays in place; `clipSpanToText`); the strike covers the whole span.
  const start = isCollapsed(selection) ? selection.anchor : clipSpanToText(editor.state, selection).anchor;
  const spanFrom = spanStart(editor.state, selection);
  const spanTo = spanEnd(editor.state, selection);
  const meta = { author: input.author, createdAt: input.createdAt, order: input.order };
  const ins = mintLineBreak(editor.state, start, { ...meta, id: input.insertionId });
  const dirtyIds = new Set<BlockId>(ins.dirtyIds);
  let state = ins.state;
  const startBlock = resolveBlock(state, start.blockId)?.block ?? null;
  const survivor = startBlock === null ? null : (blockAfter(state, startBlock)?.block.id ?? null);
  if (!isCollapsed(selection)) {
    const shift = (p: Position): Position => (p.blockId === start.blockId ? createPosition(p.blockId, p.offset + 1) : p);
    const struck = markDeletion(state, createSpan(shift(spanFrom), shift(spanTo)), { ...meta, id: input.deletionId });
    state = struck.state;
    for (const id of struck.dirtyIds) dirtyIds.add(id);
  }
  const caretBlock = resolveBlock(state, start.blockId) !== null || survivor === null ? start.blockId : survivor;
  return caretEdit({ state, dirtyIds }, createPosition(caretBlock, start.offset + 1));
}

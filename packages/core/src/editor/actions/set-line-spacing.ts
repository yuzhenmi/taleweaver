import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../state";
import type { Document, BlockId } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `SET_LINE_SPACING` handler — sets the per-block `lineHeight` attr on the
 * target LEAF block(s). The value is a unitless line-spacing MULTIPLIER (Google
 * Docs' 1.0 / 1.15 / 1.5 / 2.0 control). The attr flows render → cascade →
 * IFC: the cascade resolves the unitless ratio to a used px line-height
 * (`lineHeight × fontSize`) and the IFC honors it for each line box's block
 * size, so the page reflows to the new spacing.
 *
 * Target selection (the exact `handleSetTextAlign` model — line spacing is a
 * paragraph property, like alignment):
 *  - Collapsed selection → the single focus block.
 *  - Range selection → every LEAF block the span covers, in document order.
 *    `iterateBlocksInSpan` yields ALL covered blocks INCLUDING containers
 *    (sections, lists); we FILTER to leaves (`block.inlineContent !== null`).
 *    Containers are never spaced — Google Docs spaces paragraphs only; a
 *    section/list has no text of its own.
 *
 * Each target's attr is merged via `mergeBlockAttrs` (preserves the block's
 * other attrs). `mergeBlockAttrs` is no-op-safe: a block already carrying the
 * target spacing returns the SAME state reference, so we accumulate the running
 * state and dirty ids only when a write actually occurred.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - No target leaf changed (the running state is still `editor.document`) — the
 *    identity guard. (Notably: every target already has this spacing.)
 *
 * Selection is UNCHANGED: line spacing is a block-geometry change, not a caret
 * move.
 */
export function handleSetLineSpacing(
  editor: EditorState,
  { spacing }: ActionOf<"SET_LINE_SPACING">,
): Edit | null {
  const targetIds = targetLeafBlockIds(editor);

  let document: Document = editor.document;
  const dirtyIds = new Set<BlockId>();
  for (const blockId of targetIds) {
    // Defensive: skip a block that resolved into the target list but is now
    // missing (never expected — the ids come from the live state).
    if (getBlock(document, blockId) === null) continue;
    const result = mergeBlockAttrs(document, blockId, { lineHeight: spacing });
    // No-op merge (block already has this spacing): same state ref → skip.
    if (result.document === document) continue;
    document = result.document;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  // the identity-no-op contract: nothing changed → return the input editor unchanged
  // (the editor module's "no change → same editor reference" invariant).
  // (`history.commit` is itself no-op-safe.)
  if (document === editor.document) return null;

  return { change: { document, dirtyIds } };
}

/**
 * The LEAF block ids the spacing applies to:
 *  - collapsed selection → the focus block (if it's a leaf);
 *  - range selection → every leaf the span covers (containers filtered out).
 *
 * A leaf is a block with `inlineContent !== null` (containers — sections,
 * lists, the document root — have `inlineContent === null` and route content
 * through `firstChildId`). Spacing a container is nonsensical: it owns no text.
 */
function targetLeafBlockIds(editor: EditorState): BlockId[] {
  const { document, selection } = editor;

  if (positionsEqual(selection.anchor, selection.focus)) {
    const focus = getBlock(document, selection.focus.blockId);
    if (focus === null || focus.inlineContent === null) return [];
    return [focus.id];
  }

  const ids: BlockId[] = [];
  for (const block of iterateBlocksInSpan(document, selection)) {
    if (block.inlineContent !== null) ids.push(block.id);
  }
  return ids;
}

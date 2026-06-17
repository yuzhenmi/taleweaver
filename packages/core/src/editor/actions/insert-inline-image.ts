import type { EditorState, EditorConfig } from "../editor-state";
import { insertInlineImage, createPosition, createSpan, type BlockId } from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";

/**
 * `INSERT_INLINE_IMAGE` handler — splices an `inline-image` EmbedItem at the caret
 * (Google Docs "In line" image positioning). The embed carries the image data
 * inline (`properties: { src, width, height, alt }`) and renders as a single
 * inline-block replaced atom (see `render-core.ts`). It occupies exactly ONE
 * Position.offset unit (#407: one embed = one offset), so the caret lands just
 * AFTER it — ready for continued typing.
 *
 * **No context gate (DIVERGES from the page-field handler, MATCHES cross-reference's
 * non-template behavior minus its body-only gate).** An image may flow IN LINE with
 * text in ANY editing context — main body, a header/footer, a footnote body, a table
 * cell — exactly like text itself. `insertInlineImage` routes the write to the
 * leaf's owning tree via `resolveBlock`, so no host-context restriction applies.
 *
 * **Non-collapsed selection** is REPLACED, not preserved: `prepareEmbedInsertPoint`
 * deletes the selected range first (folding its dirtyIds into the single commit so
 * delete+insert is ONE undo step) and returns the collapse point — matching
 * INSERT_TEXT / PASTE / the other field inserts / Google Docs. A cross-context /
 * cross-parent span is un-deletable → no-op.
 *
 * Direct-mode only for v1 (no suggesting-mode soft-insert wrapper): the embed
 * splices into `inlineContent` the same way the sibling field inserts do.
 */
export function handleInsertInlineImage(
  editor: EditorState,
  src: string,
  width: number,
  height: number,
  alt: string,
  config: EditorConfig,
): EditorState {
  // Delete a non-collapsed selection first (Google Docs replaces the selection),
  // then splice the image at the collapse point. A cross-context / cross-parent
  // expanded selection is un-deletable → no-op.
  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  const result = insertInlineImage(prep.state, prep.position, { src, width, height, alt });
  // Identity invariant: nothing changed (no delete AND a no-op insert) → return the
  // editor unchanged so the "no change → same reference" contract holds.
  if (result.state === prep.state && prep.dirtyIds.size === 0) return editor;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  // The image is one offset unit; place a collapsed caret just after it.
  const cursor = createPosition(prep.position.blockId, prep.position.offset + 1);
  const selectionAfter = createSpan(cursor, cursor);

  editor.history.commit(
    { state: result.state, dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    dirtyIds,
  );
}

import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { insertInlineImage, createPosition, createSpan, type BlockId } from "../../state";
import { prepareEmbedInsertPoint } from "./helpers/prepare-embed-insert-point";
import type { ActionOf } from "../editor-action";

/**
 * `INSERT_INLINE_IMAGE` handler — splices an `inline-image` EmbedItem at the caret
 * (Google Docs "In line" image positioning). The embed carries the image data
 * inline (`properties: { src, width, height, alt }`) and renders as a single
 * inline-block replaced atom (see `render-core.ts`). It occupies exactly ONE
 * Position.offset unit (one embed = one offset), so the caret lands just
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
 * Direct-mode only (no suggesting-mode soft-insert wrapper): the embed
 * splices into `inlineContent` the same way the sibling field inserts do.
 */
export function handleInsertInlineImage(
  editor: EditorState,
  { src, width, height, alt }: ActionOf<"INSERT_INLINE_IMAGE">,
): Edit | null {
  // Delete a non-collapsed selection first (Google Docs replaces the selection),
  // then splice the image at the collapse point. A cross-context / cross-parent
  // expanded selection is un-deletable → no-op.
  const prep = prepareEmbedInsertPoint(editor.document, editor.selection);
  if (!prep.ok) return null;

  const result = insertInlineImage(prep.document, prep.position, { src, width, height, alt });
  // Identity invariant: nothing changed (no delete AND a no-op insert) → return the
  // editor unchanged so the "no change → same reference" contract holds.
  if (result.document === prep.document && prep.dirtyIds.size === 0) return null;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  // The image is one offset unit; place a collapsed caret just after it.
  const cursor = createPosition(prep.position.blockId, prep.position.offset + 1);
  const selectionAfter = createSpan(cursor, cursor);

  return { change: { document: result.document, dirtyIds }, selection: selectionAfter };
}

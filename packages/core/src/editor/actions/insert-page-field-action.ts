import type { EditorState, EditorConfig } from "../editor-state";
import {
  insertPageField,
  resolveBlock,
  selectionContextOf,
  createPosition,
  createSpan,
  type BlockId,
  type PageFieldKind,
  type PageFieldNumberStyle,
} from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";

/**
 * `INSERT_PAGE_NUMBER` / `INSERT_PAGE_COUNT` handler — splices a `page-field`
 * EmbedItem at the caret. The field renders a page-agnostic placeholder; its value
 * is bound LATE from paginated layout (self-page `page-number` = the page index;
 * document-global `page-count` = the total). One position-offset unit (one IFC
 * token), so the caret lands just after it.
 *
 * **Header/footer ONLY (DIVERGES from the cross-reference handler).** A page-number /
 * page-count is running content — Google Docs, Pages, and Word all place it in a
 * header/footer, never as a body-text control. Per the 2026-06-10 scope decision,
 * main-body (and footnote-body) page-fields are OUT of scope. So this handler is a
 * no-op UNLESS the caret resolves into a TEMPLATE (header/footer) context. Where the
 * cross-reference handler rejects everything but `state.rootId` (main body only),
 * this one rejects everything but a `templateContent` context — the opposite gate,
 * because a page-field's only valid home is a header/footer body. (The host's
 * header-editing flow places the caret inside the header before dispatching.)
 *
 * **Non-collapsed selection** is REPLACED (not preserved): `prepareEmbedInsertPoint`
 * deletes the selected range first — folding its dirtyIds into the single commit so
 * delete+insert is ONE undo step — and returns the collapse point. A cross-context /
 * cross-parent span is un-deletable → no-op.
 */
export function handleInsertPageField(
  editor: EditorState,
  fieldKind: PageFieldKind,
  numberStyle: PageFieldNumberStyle | undefined,
  config: EditorConfig,
): EditorState {
  const focus = editor.selection.focus;

  // Header/footer-only gate: the caret's selection context must be a template body.
  const contextRoot = selectionContextOf(editor.state, focus.blockId);
  if (contextRoot === null) return editor;
  const resolvedContext = resolveBlock(editor.state, contextRoot);
  if (resolvedContext === null || resolvedContext.kind !== "templateContent") return editor;

  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  const result = insertPageField(prep.state, prep.position, fieldKind, numberStyle ?? "decimal");
  if (result.state === prep.state && prep.dirtyIds.size === 0) return editor;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

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

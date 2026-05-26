import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  getTemplateContent,
  insertTemplateBody,
  productionAllocator,
  createPosition,
  createSpan,
} from "../../state";
import type { BlockId, TemplateRegion } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `INSERT_HEADER` / `INSERT_FOOTER` handler — the C.2c browser-verify vehicle.
 *
 * Creates a one-paragraph header/footer template body, links it on the
 * DOCUMENT ROOT (the implicit section, `state.rootId`), and places a collapsed
 * caret at the start of the new body so the user can immediately type. Once the
 * caret is in the body, the (map-agnostic, T7) edit ops mutate templateContents
 * — type "Hi" and it repeats on every page.
 *
 * **Idempotency (Google Docs: one header / one footer per document).** If the
 * doc-root already links an EXISTING template body for this region, we do NOT
 * create a duplicate: we simply move the caret into the existing body (offset 0
 * of its root) and return, never calling `history.commit` (no state change). A
 * dangling link (attr set but the body absent — shouldn't happen) is treated as
 * "no existing body" and a fresh one is created.
 *
 * Selection-after on the CREATE path: a collapsed caret at `{ bodyRootId, 0 }`.
 */
export function handleInsertHeaderFooter(
  editor: EditorState,
  region: TemplateRegion,
  config: EditorConfig,
): EditorState {
  const sectionBlockId = editor.state.rootId;
  const attrKey = region === "header" ? "headerBlockId" : "footerBlockId";

  // Idempotency: if the doc-root already links an existing body for this
  // region, place the caret in it (or no-op if already there) and return.
  const section = getBlock(editor.state, sectionBlockId);
  const existingId = section?.attrs[attrKey];
  if (
    typeof existingId === "string" &&
    getTemplateContent(editor.state, existingId as BlockId) !== null
  ) {
    const cursor = createPosition(existingId as BlockId, 0);
    const selectionAfter = createSpan(cursor, cursor);
    return { ...editor, selection: selectionAfter };
  }

  // Create + link a fresh one-paragraph body, atomically.
  const result = insertTemplateBody(
    editor.state,
    { region, sectionBlockId },
    productionAllocator,
  );

  const cursor = createPosition(result.bodyRootId, 0);
  const selectionAfter = createSpan(cursor, cursor);

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    result.dirtyIds,
  );
}

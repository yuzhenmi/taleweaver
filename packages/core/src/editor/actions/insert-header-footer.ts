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
import { resolveActiveSection } from "./active-section";

/**
 * `INSERT_HEADER` / `INSERT_FOOTER` handler — the C.2c browser-verify vehicle.
 *
 * Creates a header/footer template body (a `template-body` CONTAINER holding
 * one empty paragraph), links the CONTAINER on the cursor's ACTIVE SECTION (the
 * `section` block enclosing the focus, via `resolveActiveSection`; or the
 * document root when the cursor is in leading / section-less content), and
 * places a collapsed caret at the start of the body's PARAGRAPH child so the
 * user can immediately type. Once the caret is in the paragraph, the
 * (map-agnostic, T7) edit ops mutate templateContents — type "Hi" and it
 * repeats on every page; press Enter and a new sibling paragraph is added
 * UNDER the container (the slot renders both lines, #326).
 *
 * **Idempotency (Google Docs: one header / one footer per section).** If the
 * active section already links an EXISTING template body for this region, we do
 * NOT create a duplicate: we move the caret into the existing body's FIRST
 * paragraph child (offset 0) and return, never calling `history.commit` (no
 * state change). A dangling link (attr set but the body absent — shouldn't
 * happen) is treated as "no existing body" and a fresh one is created. A body
 * with no resolvable first child (shouldn't happen) falls back to the container
 * root.
 *
 * Selection-after on the CREATE path: a collapsed caret at the paragraph child,
 * `{ firstParagraphId, 0 }`.
 */
export function handleInsertHeaderFooter(
  editor: EditorState,
  region: TemplateRegion,
  config: EditorConfig,
): EditorState {
  // The header/footer links onto the cursor's ACTIVE SECTION — the `section`
  // block enclosing the focus — so section 2 gets its own header (mirrors
  // `TOGGLE_SECTION_LANDSCAPE` / `SET_SECTION_COLUMNS`). When the cursor is in
  // leading / section-less content (`resolveActiveSection` → null), it falls
  // back to the document root (the implicit section).
  const sectionBlockId =
    resolveActiveSection(editor, editor.selection.focus.blockId) ??
    editor.state.rootId;
  const attrKey = region === "header" ? "headerBlockId" : "footerBlockId";

  // Idempotency: if the active section already links an existing body for this
  // region, place the caret in its FIRST paragraph child (the editable line)
  // and return. The link points at the CONTAINER root; resolve its
  // `firstChildId` to find the editable paragraph.
  const section = getBlock(editor.state, sectionBlockId);
  const existingId = section?.attrs[attrKey];
  if (typeof existingId === "string") {
    const existingBody = getTemplateContent(editor.state, existingId as BlockId);
    if (existingBody !== null) {
      // Caret into the first paragraph child; fall back to the container root
      // only if (unexpectedly) it has no child.
      const caretId = existingBody.firstChildId ?? (existingId as BlockId);
      const cursor = createPosition(caretId, 0);
      const selectionAfter = createSpan(cursor, cursor);
      return { ...editor, selection: selectionAfter };
    }
  }

  // Create + link a fresh body (container + paragraph child), atomically.
  const result = insertTemplateBody(
    editor.state,
    { region, sectionBlockId },
    productionAllocator,
  );

  const cursor = createPosition(result.firstParagraphId, 0);
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

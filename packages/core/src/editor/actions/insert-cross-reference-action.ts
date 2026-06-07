import type { EditorState, EditorConfig } from "../editor-state";
import {
  insertCrossReference,
  getBlock,
  getListDefsForState,
  classifyListDef,
  selectionContextOf,
  createPosition,
  createSpan,
  type BlockId,
  type CrossReferenceMode,
} from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `INSERT_CROSS_REFERENCE` handler — splices a `cross-reference` EmbedItem at the
 * caret that displays the target's number (`refMode: "number"`) or text
 * (`refMode: "text"`), auto-updating when the target changes (XR.S4 wires the
 * incremental propagation).
 *
 * **The S1 op TRUSTS its `targetId`** (validation deliberately lives here, not in
 * the Layer-3 op, mirroring how editor handlers gate structural preconditions).
 * This handler rejects — returns the editor UNCHANGED — when:
 *
 *  - the caret is NOT in the main document body. A cross-reference may only be
 *    inserted into body text (which resolves to `state.rootId`), not inside a
 *    header / footer / footnote body. This keeps the set of host blocks aligned
 *    with XR.S4's `buildCrossReferenceIndex`, which scans the main tree only —
 *    a ref in an embed body would never receive target-update propagation.
 *    Mirrors the footnote handler's context guard.
 *  - the `targetId` does not resolve to a MAIN-TREE block (`getBlock` returns
 *    null — the target was never created, lives in an embed/template body, or
 *    was deleted).
 *  - the target is the WRONG KIND for the mode: `"number"` requires an ORDERED
 *    `list-item` (an unordered/bulleted item has no number — it would resolve to
 *    a bullet glyph, not a reference number, so it is rejected here rather than
 *    silently producing "•"); `"text"` requires an inline-bearing block (a
 *    container has no text to extract).
 *
 * A rejected insert is a silent no-op (the host app validates target choice in
 * its picker UI; this is the engine-level backstop). On success the ref occupies
 * exactly ONE position-offset unit, so the caret lands just AFTER it
 * (`focus.offset + 1`), ready for continued typing — the Google-Docs field
 * convention.
 */
export function handleInsertCrossReference(
  editor: EditorState,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  config: EditorConfig,
): EditorState {
  const focus = editor.selection.focus;

  // Body-text-only: refuse a cross-reference inside a footnote / header / footer
  // body (a non-root context), matching XR.S4's main-tree host index.
  if (selectionContextOf(editor.state, focus.blockId) !== editor.state.rootId) {
    return editor;
  }

  // Structural target validation (the op trusts targetId; we gate it here).
  const target = getBlock(editor.state, targetId);
  if (target === null) return editor; // dangling / non-main-tree target
  if (refMode === "number") {
    // A number ref needs an ORDERED list-item — an unordered (bulleted) item has
    // no counter to display. Classify by the item's list def (the same
    // level-0-style rule the toggle/set-list-type handlers use).
    if (target.type !== "list-item") return editor;
    const listIdRaw = target.attrs["listId"];
    const def =
      typeof listIdRaw === "string"
        ? getListDefsForState(editor.state).get(listIdRaw)
        : undefined;
    if (def === undefined || classifyListDef(def) !== "ordered") return editor;
  }
  if (refMode === "text" && target.inlineContent === null) return editor;

  const result = insertCrossReference(editor.state, focus, targetId, refMode);

  // The ref is one offset unit; place a collapsed caret just after it.
  const cursor = createPosition(focus.blockId, focus.offset + 1);
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

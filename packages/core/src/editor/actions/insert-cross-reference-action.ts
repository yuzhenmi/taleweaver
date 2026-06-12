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
  type PageFieldNumberStyle,
} from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";

/**
 * `INSERT_CROSS_REFERENCE` handler — splices a `cross-reference` EmbedItem at the
 * caret that displays the target's number (`refMode: "number"`), text
 * (`refMode: "text"`), or PAGE number (`refMode: "page"`), auto-updating when the
 * target changes (XR.S4 wires the number/text incremental propagation; page mode
 * is resolved late from paginated layout — see `1.5-pagination.md`).
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
 *    silently producing "•"); `"text"` and `"page"` require an inline-bearing
 *    block (a container has no text to extract, and no single meaningful page —
 *    its content spans pages). Any inline-bearing block has a deterministic page.
 *
 * `numberStyle` is honored for `"page"` mode (the displayed page number's format,
 * default `"decimal"`); it is ignored by `"number"`/`"text"` (the S1 op stores it
 * only for the `"page"` variant).
 *
 * A rejected insert is a silent no-op (the host app validates target choice in
 * its picker UI; this is the engine-level backstop).
 *
 * **Non-collapsed selection** is REPLACED, not preserved: `prepareEmbedInsertPoint`
 * deletes the selected range first (folding its dirtyIds into the single commit
 * so delete+insert is one undo step) and returns the collapse point — matching
 * INSERT_TEXT / PASTE / Google Docs. A cross-context / cross-parent span is
 * un-deletable → no-op. On success the ref occupies exactly ONE position-offset
 * unit, so the caret lands just AFTER it (`position.offset + 1`), ready for
 * continued typing — the Google-Docs field convention.
 */
export function handleInsertCrossReference(
  editor: EditorState,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  config: EditorConfig,
  numberStyle?: PageFieldNumberStyle,
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
  // "text" and "page" both require an inline-bearing target: "text" extracts the
  // target's text, "page" needs a content block with a deterministic page (a
  // container's content spans pages). Number-mode is gated above.
  if ((refMode === "text" || refMode === "page") && target.inlineContent === null) {
    return editor;
  }

  // Delete a non-collapsed selection first (Google Docs replaces the selection),
  // then splice the field at the collapse point. A cross-context / cross-parent
  // expanded selection is un-deletable → no-op.
  //
  // The target was validated against the PRE-delete state. If the selection
  // happened to span the target block and the delete merged it away, the ref is
  // now dangling — a documented LEGAL state that renders as broken-ref (see the
  // cross-references section of state-of-branch.md), not a bug.
  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  const result = insertCrossReference(
    prep.state,
    prep.position,
    targetId,
    refMode,
    // page mode stores numberStyle (default decimal); number/text ignore it (the op
    // only persists numberStyle for the "page" variant).
    refMode === "page" ? (numberStyle ?? "decimal") : "decimal",
  );
  // Identity invariant: nothing changed (no delete AND a no-op insert) → return
  // the editor unchanged so the "no change → same reference" contract holds.
  if (result.state === prep.state && prep.dirtyIds.size === 0) return editor;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  // The ref is one offset unit; place a collapsed caret just after it.
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

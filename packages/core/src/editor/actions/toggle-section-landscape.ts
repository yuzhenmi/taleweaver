import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `TOGGLE_SECTION_LANDSCAPE` handler — toggles the page-geometry override on
 * the SECTION at the cursor between doc-wide and LANDSCAPE (the doc-wide
 * dimensions swapped → wider + shorter pages). This is the editor surface for
 * the per-section page geometry (C.2b-2): it only SETS / CLEARS the section
 * block's `attrs.pageInlineSize` / `attrs.pageBlockSize`; the render→layout
 * pipeline already flows those attrs to per-section page geometry.
 *
 * No-ops (return the input `editor` unchanged, never calling `history.commit`):
 *  - `config.pageConfig === undefined` (unpaginated harness): the doc-wide dims
 *    needed to compute the landscape swap are unknown.
 *  - No active section: the cursor is in a bare doc-root document (no
 *    SECTION_BREAK has been made), so the doc-root child the focus sits under
 *    is not a `section`.
 *  - The merge is a no-op (`mergeBlockAttrs` returns the same state reference):
 *    the T7 identity guard short-circuits before `history.commit` (whose
 *    pre-condition forbids a no-op commit).
 *
 * Selection is UNCHANGED: a geometry change does not move the cursor logically.
 */
export function handleToggleSectionLandscape(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { pageConfig } = config;
  // Can't determine the landscape (swapped) dimensions without the doc-wide
  // page config.
  if (pageConfig === undefined) return editor;

  const sectionId = resolveActiveSection(editor, editor.selection.focus.blockId);
  if (sectionId === null) return editor;

  const section = getBlock(editor.state, sectionId);
  if (section === null) return editor;

  // "Currently landscape" iff the section carries a numeric inline-size
  // override. Toggling clears it (falls back to doc-wide); otherwise set the
  // doc-wide dimensions SWAPPED.
  const currentlyLandscape = typeof section.attrs.pageInlineSize === "number";
  const incoming = currentlyLandscape
    ? { pageInlineSize: undefined, pageBlockSize: undefined }
    : {
        pageInlineSize: pageConfig.pageBlockSize,
        pageBlockSize: pageConfig.pageInlineSize,
      };

  const result = mergeBlockAttrs(editor.state, sectionId, incoming, config.attrRegistry);

  // T7 identity contract: a no-op merge returns the same state reference.
  if (result.state === editor.state) return editor;

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * Resolve the `section` block governing the cursor's focus block, or null if
 * there is none.
 *
 * Sections are FLAT under the doc root (they never nest). The active section is
 * the doc-root child the focus sits under, IFF that child's `type === "section"`.
 * Walk `parentId` up from the focus block until the next step would leave the
 * doc root (`parentId === null` or `parentId === state.rootId`) — the current
 * block is then the doc-root child. A null `getBlock` anywhere mid-walk →
 * treat as no section (never throw). A step cap (`MAX_PARENT_WALK_STEPS`, a
 * realistic nesting-depth bound) guards against a pathological parent cycle; a
 * cap-exceeded walk also degrades to no-section (returns null) rather than
 * throwing.
 */
function resolveActiveSection(
  editor: EditorState,
  focusBlockId: BlockId,
): BlockId | null {
  const state = editor.state;
  let current = getBlock(state, focusBlockId);
  if (current === null) return null;

  // Cycle-detection bound: each step strictly ascends the parent chain, so the
  // cap is the maximum legitimate nesting DEPTH (see `MAX_PARENT_WALK_STEPS`).
  // A corrupt cyclic parent chain trips the cap within a few thousand
  // iterations and degrades to no-section.
  let steps = 0;
  const maxSteps = MAX_PARENT_WALK_STEPS;
  while (true) {
    // Cap-exceeded → degrade to "no active section" (return null) rather than
    // throw: this function MUST NEVER throw (a corrupt parent cycle would
    // otherwise crash the editor through reduceEditor). A no-section result
    // makes the handler a no-op.
    if (++steps > maxSteps) {
      return null;
    }
    const parentId = current.parentId;
    // The doc-root child is reached when its parent is the root (or null for a
    // malformed/detached chain).
    if (parentId === null || parentId === state.rootId) {
      return current.type === "section" ? current.id : null;
    }
    const parent = getBlock(state, parentId);
    if (parent === null) return null;
    current = parent;
  }
}

/**
 * Step cap for `resolveActiveSection`'s parent walk. Each step strictly ascends
 * the parent chain, so the bound is the maximum legitimate document NESTING
 * DEPTH (not block count). `1_000` exceeds any realistic nesting depth by orders
 * of magnitude while still firing the cycle guard within a few thousand
 * iterations rather than spinning the UI thread millions of times on a corrupt
 * cyclic parent chain.
 */
const MAX_PARENT_WALK_STEPS = 1_000;

import type { EditorState } from "../editor-state";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

/**
 * Step cap for `resolveActiveSection`'s parent walk. Each step strictly ascends
 * the parent chain, so the bound is the maximum legitimate document NESTING
 * DEPTH (not block count). `1_000` exceeds any realistic nesting depth by orders
 * of magnitude while still firing the cycle guard within a few thousand
 * iterations rather than spinning the UI thread millions of times on a corrupt
 * cyclic parent chain.
 */
const MAX_PARENT_WALK_STEPS = 1_000;

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
 *
 * Shared by the per-section editor actions (`TOGGLE_SECTION_LANDSCAPE`,
 * `SET_SECTION_COLUMNS`) so the parent-walk is defined once.
 */
export function resolveActiveSection(
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

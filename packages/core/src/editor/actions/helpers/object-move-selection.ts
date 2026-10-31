import { createPosition, createSpan } from "../../../state";
import type { BlockId, State, Selection } from "../../../state";
import { findNextContentBlock, findPrevContentBlock } from "../../../cursor/cursor-ops";
import { contentLengthForState } from "./content-length-for-state";

/**
 * The PURE selection a `moveOffObject` resolves to — the collapsed caret BESIDE
 * the object (forward → start of the next content block; backward → end of the
 * previous one), or `null` at the document edge (no neighbour). Factored out of
 * `moveOffObject` so the print backend's NavIntent resolver (which owns the
 * geometric ArrowLeft/Right/Up/Down handlers) computes the IDENTICAL
 * object-nav selection without an `EditorState`, then dispatches it as a
 * `SET_SELECTION`. Takes a bare `Document` (not `EditorState`) so it is reusable
 * across the seam.
 */
export function objectMoveSelection(
  state: State,
  objId: BlockId,
  direction: "forward" | "backward",
): Selection | null {
  if (direction === "forward") {
    const nextId = findNextContentBlock(state, objId);
    if (nextId === null) return null;
    const caret = createPosition(nextId, 0);
    return createSpan(caret, caret);
  }
  const prevId = findPrevContentBlock(state, objId);
  if (prevId === null) return null;
  const caret = createPosition(prevId, contentLengthForState(state, prevId));
  return createSpan(caret, caret);
}

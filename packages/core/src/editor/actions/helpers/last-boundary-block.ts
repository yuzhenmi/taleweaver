import { lastLeafBlock } from "../../../state";
import type { BlockId, State } from "../../../state";
import { findLastContentBlock } from "./find-last-content-block";

/** Symmetric to `firstBoundaryBlock` for the document END. */
export function lastBoundaryBlock(state: State, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === state.rootId
    ? findLastContentBlock(state)
    : lastLeafBlock(state, ctxRoot);
}

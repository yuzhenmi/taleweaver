import { firstLeafBlock } from "../../../state";
import type { BlockId, State } from "../../../state";
import { findFirstContentBlock } from "./find-first-content-block";

/**
 * The first boundary block within `ctxRoot`. Main body → the first
 * CONTENT-bearing leaf (`findFirstContentBlock`, which skips container-only
 * leaves). A footnote/header/footer body → the first leaf within that body
 * (`firstLeafBlock`). Mirrors `handleSelectAll`.
 */
export function firstBoundaryBlock(state: State, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === state.rootId
    ? findFirstContentBlock(state)
    : firstLeafBlock(state, ctxRoot);
}

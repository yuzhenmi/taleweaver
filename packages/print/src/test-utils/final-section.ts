import { getBlock, type Block, type State } from "@taleweaver/core";

/**
 * The block whose children are a break-less document's body blocks: its final
 * section (the root's children are sections only).
 */
export function finalSection(state: State): Block | null {
  const root = getBlock(state, state.rootId);
  return root === null || root.lastChildId === null ? null : getBlock(state, root.lastChildId);
}

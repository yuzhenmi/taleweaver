/**
 * Layer 3 state-mutating operations barrel.
 *
 * Each operation takes a State (Y.Doc-backed per Decision C) and
 * arguments, returns OperationResult (new state + dirtyIds of changed
 * blocks). Internally each op opens a Y.Doc transaction via
 * applyOperation; the dirtyIds set is captured from the transaction's
 * change records.
 *
 * Exception: clonePastedSubtree returns a ClonedSubtree snapshot for
 * paste flows (no State mutation; returns a plain JS map of cloned
 * Block snapshots that the caller decides where to insert).
 */

export { setBlockAttrs } from "./set-block-attrs";
export { mergeBlockAttrs } from "./merge-block-attrs";
export { setBlockType } from "./set-block-type";
export { insertBlock, type InsertBlockArgs } from "./insert-block";
export { insertBlocksAfter, type SiblingBlockInit } from "./insert-blocks-after";
export { removeBlock } from "./remove-block";
export { insertText } from "./insert-text";
export { applyAttrsToRange } from "./apply-attrs";
export { splitBlockAtPosition } from "./split-block";
export { mergeAdjacentBlocks } from "./merge-blocks";
export { deleteRange } from "./delete-range";
export { replaceRange } from "./replace-range";
export { clonePastedSubtree, type ClonedSubtree } from "./clone-pasted-subtree";
export {
  reparentChildren,
  computeReparentWrites,
  planReparentChildren,
  reparentChildrenInTx,
  type BlockFieldWrite,
  type ReparentPlan,
} from "./reparent-children";
export {
  applySectionBreak,
  type SectionBreakResult,
} from "./section-break";

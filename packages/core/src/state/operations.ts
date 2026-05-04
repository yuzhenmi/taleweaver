/**
 * Layer 3 state-mutating operations barrel.
 *
 * Each operation takes a State and arguments, returns OperationResult
 * (new state + dirtyIds of changed blocks). All operations are pure
 * functions over the immutable state.
 *
 * Phase 4a operations (this commit): block-level operations that
 * change one block's attrs/type or splice a block into/out of a
 * parent's linked-list children.
 *
 * Subsequent phases will append:
 *   - Phase 4b: insert-text, apply-attrs (inline-content edits)
 *   - Phase 4c: split-block, merge-blocks, delete-range, replace-range
 *               (cross-block structural surgery)
 *   - Phase 4d: clone-pasted-subtree (paste mechanics)
 */

// Phase 4a operations
export { setBlockAttrs } from "./set-block-attrs";
export { setBlockType } from "./set-block-type";
export { insertBlock, type InsertBlockArgs } from "./insert-block";
export { removeBlock } from "./remove-block";

// Legacy tree operations (pre-Phase 4a, to be migrated)
export { updateProperties, insertChild, removeChild, getNodeByPath, updateAtPath } from "./node-operations";

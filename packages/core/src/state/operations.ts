/**
 * Layer 3 state-mutating operations barrel.
 *
 * Each operation takes a State and arguments, returns OperationResult
 * (new state + dirtyIds of changed blocks) — except for clonePastedSubtree
 * which returns a self-contained ClonedSubtree snapshot for paste flows.
 * All operations are pure functions over the immutable state.
 *
 * Phase 4 surface (now complete):
 *   - Phase 4a: setBlockAttrs, setBlockType, insertBlock, removeBlock
 *   - Phase 4b: insertText
 *   - Phase 4c-1: applyAttrsToRange
 *   - Phase 4c-2: splitBlockAtPosition
 *   - Phase 4c-3: mergeAdjacentBlocks
 *   - Phase 4c-4: deleteRange
 *   - Phase 4c-5: replaceRange
 *   - Phase 4d: clonePastedSubtree (paste mechanics)
 *
 * Legacy tree operations (pre-Phase 4a, to be migrated in Phase 14
 * cleanup): updateProperties, insertChild, removeChild, getNodeByPath,
 * updateAtPath.
 */

// Phase 4a operations
export { setBlockAttrs } from "./set-block-attrs";
export { setBlockType } from "./set-block-type";
export { insertBlock, type InsertBlockArgs } from "./insert-block";
export { removeBlock } from "./remove-block";

// Phase 4b operations (inline-content edits)
export { insertText } from "./insert-text";

// Phase 4c-1 operations (range attribute application)
export { applyAttrsToRange } from "./apply-attrs";

// Phase 4c-2 operations (block split)
export { splitBlockAtPosition } from "./split-block";

// Phase 4c-3 operations (block merge)
export { mergeAdjacentBlocks } from "./merge-blocks";

// Phase 4c-4 operations (range delete)
export { deleteRange } from "./delete-range";

// Phase 4c-5 operations (range replace)
export { replaceRange } from "./replace-range";

// Phase 4d operations (paste mechanics)
export { clonePastedSubtree, type ClonedSubtree } from "./clone-pasted-subtree";

// Legacy tree operations (pre-Phase 4a, to be migrated)
export { updateProperties, insertChild, removeChild, getNodeByPath, updateAtPath } from "./node-operations";

/**
 * Module-private Symbol gating access to Document's underlying Y.Doc and
 * snapshot cache. The Symbol is exported only from this file; importing
 * it is the privilege of state-module-internal code. External modules
 * cannot reach `state[DOCUMENT_INTERNAL]` because they cannot import the
 * Symbol they would need to index by.
 *
 * MUST NOT be re-exported from `packages/core/src/index.ts` (or any
 * other barrel). The whole point of the Symbol is that only direct
 * deep imports from inside `state/` can spell it.
 */
export const DOCUMENT_INTERNAL: unique symbol = Symbol("document.internal");

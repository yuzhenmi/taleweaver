import type { EditorAction } from "./editor-action";

/**
 * Module-private Symbol gating write access to an Editor's fields. The Symbol is
 * exported only from this file; importing it is the privilege of the editor's
 * internal writers (the reducer, `applyEdit`, extensions, foreign-change
 * reconciliation). Hosts read the fields through the Editor's getters and change
 * them only through `dispatch` / `setConfig`, because they cannot import the Symbol
 * they would need to index by.
 *
 * MUST NOT be re-exported from `packages/core/src/index.ts` (or any
 * other barrel).
 */
export const EDITOR_INTERNAL: unique symbol = Symbol("editor.internal");

/**
 * Told when a QUEUED action (see `Editor.dispatch`) threw and was rolled back — its
 * dispatcher had already returned. Keyed by the dispatched action object;
 * `dispatchProposal` uses it to settle its promise. Core-internal, like the Symbol above.
 */
export const ACTION_FAILURES = new WeakMap<EditorAction, () => void>();

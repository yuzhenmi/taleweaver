import type { State, OperationResult } from "./state";
import { applyOperation } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { normalizeSpan } from "./span-iteration";
import {
  assertDeleteRangeEndpoints,
  deleteRangeInTx,
  planDeleteRange,
} from "./delete-range";
import { insertText, insertTextInTx, planInsertTextFullReplace } from "./insert-text";
import { STATE_INTERNAL } from "./state-internal";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * Replace the inline content within a Span with the given text + attrs.
 *
 * Composes deleteRange and insertText:
 *   1. If the span is non-collapsed, delete its content.
 *   2. If the text is non-empty, insert it at the cursor position.
 *
 * The cursor position lands at the seam between the surviving anchor
 * prefix and the focus suffix — i.e., `{ normalized.anchor.blockId,
 * normalized.anchor.offset }` post-delete.
 *
 * `attrs` is the formatting for the inserted text. Caller computes the
 * intended formatting (e.g., from the cursor's containing run, or a
 * paste payload's attrs).
 *
 * Returns OperationResult with dirtyIds = the set of block ids touched
 * by the composite (delete + insert) Y.Doc transaction.
 *
 * Atomicity (T12): for the non-collapsed + non-empty path, the delete
 * and insert mutations run inside a SINGLE `applyOperation` /
 * `runTransaction` boundary. A collab peer subscribing to the doc sees
 * the composite as one atomic change — there is no observable
 * post-delete pre-insert mid-state. The single-transaction
 * `afterTransaction` listener captures dirtyIds from both mutations, so
 * no explicit union is needed.
 *
 * Error contract for the non-collapsed paths: existence + leaf are
 * checked in this function's pre-normalize guards (emitting deleteRange-
 * prefixed messages — see "Why normalizeSpan runs BEFORE deleteRange"
 * below); the remaining validations (cross-parent, offset bounds,
 * sibling reachability) come from `planDeleteRange`. For the collapsed-
 * insert path, errors come from `insertText`. After the delete plan is
 * validated, the cursor position is always valid in the post-delete
 * anchor block (the seam at `normalized.anchor.offset` is within the
 * `mergedItems` array by construction).
 *
 * Behavior:
 *   - Collapsed span + empty text: pure no-op.
 *   - Collapsed span + non-empty text: insertText only (delegates to
 *     the public op — a single transaction).
 *   - Non-collapsed span + empty text: delete only (single transaction).
 *   - Non-collapsed span + non-empty text: delete + insert in ONE
 *     transaction (T12 atomicity).
 *
 * Why normalizeSpan runs BEFORE the delete (architectural note):
 * normalizeSpan reads the focus block to compute document order
 * (comparePositions → compareBlocksInDocOrder → ancestorChain →
 * getBlock(focus)). Running it AFTER deletion would read against a
 * post-delete state where the focus block has been removed from the
 * Y.Doc — the read would return null, ancestorChain would yield [],
 * and compareBlocksInDocOrder would throw "block ... not found" on
 * what is a successful replace. Running normalizeSpan FIRST (and
 * computing both plans before opening `applyOperation`) reads against
 * the pre-mutation state.
 *
 * Error-contract preservation: normalizeSpan's compareBlocksInDocOrder
 * has its own "block ... not found" error message for missing blocks,
 * which would shadow this op's prefixed contract ("anchor block ... not
 * found", "focus block ... not found") if it fired first. To preserve
 * the contract, this function runs the same pre-normalize existence +
 * leaf guards that deleteRange uses (anchor/focus reads + container
 * checks) BEFORE calling normalizeSpan. The remaining validations
 * (cross-parent, offset bounds, intervening-sibling reachability) stay
 * in `planDeleteRange`, which runs after normalize. The prefixed error
 * contract is therefore split across the pre-flight guards in this
 * function (existence / leaf) and `planDeleteRange`'s own checks
 * (everything else), but the externally observable contract from
 * `replaceRange`'s caller is unchanged.
 *
 * `registry` (optional): an `AttrRegistry`; threaded to `deleteRange`'s
 * seam-merge and `insertText`'s run-merge so interpreters with a custom
 * per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics across
 * both phases of the composite. Omitted → deep-value compare.
 */
export function replaceRange(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  const isCollapsed =
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset;

  // Collapsed span (no range to delete).
  if (isCollapsed) {
    // Pure no-op when there's also no text to insert.
    if (text === "") {
      return { state, dirtyIds: new Set<BlockId>() };
    }
    // Insert-only path. The cursor is just span.anchor — no normalization
    // needed for a collapsed span. Delegating to the public `insertText`
    // runs the entire op in its own (single) transaction — atomicity is
    // trivially satisfied since there is no delete step.
    return insertText(state, span.anchor, text, attrs, registry);
  }

  // Non-collapsed span.
  //
  // Pre-normalize existence + leaf guards. Shared with `planDeleteRange`
  // via `assertDeleteRangeEndpoints` — they emit the same "deleteRange:"-
  // prefixed messages. They have to run here too because normalizeSpan
  // invokes compareBlocksInDocOrder, whose generic "block ... not found"
  // message would otherwise leak through to the caller and shadow this
  // operation's stated error contract.
  assertDeleteRangeEndpoints(state, span);

  // Normalize FIRST so the read happens against the pre-delete state
  // where the focus block still exists in the Y.Doc. The normalized
  // anchor's blockId is the surviving anchor block; its offset is the
  // seam in the post-delete merged content.
  const normalized = normalizeSpan(state, span);

  // Plan the deletion. planDeleteRange runs all the cross-parent /
  // offset / sibling-reachability checks that the legacy public
  // `deleteRange` ran. A `null` return means the span re-collapsed
  // after normalization — treat as no-op (no delete, no insert).
  const deletePlan = planDeleteRange(state, span, registry);

  // Delete-only path (insert is a no-op because text === "").
  if (text === "") {
    if (deletePlan === null) {
      return { state, dirtyIds: new Set<BlockId>() };
    }
    return applyOperation(state, () => {
      deleteRangeInTx(state[STATE_INTERNAL].doc, deletePlan);
    });
  }

  // Full replace path: delete + insert, ONE transaction (T12).
  //
  // The insertion plan is built against `deletePlan.mergedItems` — the
  // anchor block's POST-DELETE inlineContent — and NOT against
  // `state` (whose snapshot of the anchor block is still pre-delete).
  // `deleteRangeInTx` will create a fresh Y.Array for the anchor block's
  // inlineContent inside the transaction; `insertTextInTx` will then
  // full-replace it again with the post-insert items. Two writes to the
  // same Y key inside one transaction is correct (Yjs collapses them
  // into one observable state at commit) but means the in-place
  // strategy is moot here — the existing Y.Text identity is blown away
  // by the delete step regardless. We use `planInsertTextFullReplace`
  // which forces mode=full-replace.
  //
  // Edge case: deletePlan === null after normalization re-collapse. The
  // logical operation reduces to a pure insert at the (collapsed)
  // cursor position. Fall back to the public `insertText` which runs
  // its own single transaction.
  if (deletePlan === null) {
    return insertText(state, normalized.anchor, text, attrs, registry);
  }

  const cursorOffset = normalized.anchor.offset;
  const anchorBlockId =
    deletePlan.mode === "same-block" ? deletePlan.blockId : deletePlan.anchorId;
  // C.2c T7b: `planInsertTextFullReplace` now requires the anchor block's
  // owning tree. replaceRange's map-agnostic wiring (resolving the anchor's
  // kind, plus the multi-block new-block-inherits-map work) is C.2c T7c; until
  // then this stays the main-tree default `"block"`, preserving byte-identical
  // behavior for every current (main-tree) caller.
  const insertPlan = planInsertTextFullReplace(
    anchorBlockId,
    "block",
    deletePlan.mergedItems,
    cursorOffset,
    text,
    attrs,
    registry,
  );

  return applyOperation(state, () => {
    const doc = state[STATE_INTERNAL].doc;
    deleteRangeInTx(doc, deletePlan);
    insertTextInTx(doc, insertPlan);
  });
}

import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation } from "../state";
import type { BlockId } from "../block-id";
import type { Span } from "../block-position";
import type { ReadonlyAttrs } from "../attrs";
import { normalizeSpan } from "../span-iteration";
import {
  assertDeleteRangeEndpoints,
  deleteRangeInTx,
  planDeleteRange,
  type DeleteRangePlan,
} from "./delete-range";
import {
  insertTextInTx,
  planInsertText,
  planInsertTextFullReplace,
  type InsertTextPlan,
} from "./insert-text";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `replaceRangeInTx`. Produced by
 * `planReplaceRange` from the pure validate+normalize+plan logic. The
 * straight-line InTx body runs `deletePlan` (if any) then `insertPlan`
 * (if any), so EVERY case `replaceRange` handles is folded into these two
 * optional sub-plans:
 *
 *   - Collapsed span + non-empty text  → `{ deletePlan: null, insertPlan }`
 *     (a pure insert at the collapsed cursor).
 *   - Non-collapsed span + empty text  → `{ deletePlan, insertPlan: null }`
 *     (a pure delete).
 *   - Non-collapsed + non-empty        → `{ deletePlan, insertPlan }`
 *     (delete then insert, ONE transaction — T12 atomicity).
 *   - Re-collapsed-after-normalize + non-empty text → `{ deletePlan: null,
 *     insertPlan }` (logical op reduces to a plain insert at the cursor).
 *
 * The collapsed/empty no-op (collapsed span + empty text) and the
 * delete-plan-null-with-empty-text no-op short-circuit BEFORE producing a
 * plan: `planReplaceRange` returns `null`, signalling the caller to no-op.
 *
 * Critically, `insertPlan` is always a `full-replace` InsertTextPlan when
 * it follows a `deletePlan` — the post-delete Y.Array doesn't exist yet
 * (deleteRangeInTx creates it), so an in-place plan would be unsafe. When
 * `deletePlan` is null (the pure-insert cases), `insertPlan` is the regular
 * `planInsertText` result (in-place or full-replace — both are safe, as no
 * prior write blew away the Y.Text identity in the same transaction).
 */
export interface ReplaceRangePlan {
  readonly deletePlan: DeleteRangePlan | null;
  readonly insertPlan: InsertTextPlan | null;
}

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
 * checked in `planReplaceRange`'s pre-normalize guards (emitting
 * deleteRange-prefixed messages — see "Why normalizeSpan runs BEFORE
 * deleteRange" below); the remaining validations (cross-parent, offset
 * bounds, sibling reachability) come from `planDeleteRange`. For the
 * collapsed-insert path, errors come from `planInsertText`. After the
 * delete plan is validated, the cursor position is always valid in the
 * post-delete anchor block (the seam at `normalized.anchor.offset` is
 * within the `mergedItems` array by construction).
 *
 * Behavior:
 *   - Collapsed span + empty text: pure no-op.
 *   - Collapsed span + non-empty text: insert only (single transaction).
 *   - Non-collapsed span + empty text: delete only (single transaction).
 *   - Non-collapsed span + non-empty text: delete + insert in ONE
 *     transaction (T12 atomicity).
 *
 * `replaceRange` is a thin composition: `planReplaceRange` (pure
 * validate + normalize + plan) then `applyOperation(replaceRangeInTx)`.
 * The split lets `REPLACE_MATCH`/composite callers reuse the planner and
 * the in-transaction primitive — see `replaceRangeInTx`.
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
  const plan = planReplaceRange(state, span, text, attrs, registry);
  if (plan === null) {
    // No-op (collapsed + empty text, or re-collapsed delete with empty text).
    return { state, dirtyIds: new Set<BlockId>() };
  }
  return applyOperation(state, (doc) => {
    replaceRangeInTx(doc, plan);
  });
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `ReplaceRangePlan`
 * to `doc`. Caller is responsible for all validation (done by
 * `planReplaceRange`) and for opening the surrounding `applyOperation` /
 * `runTransaction` (this function MUST run inside an already-open
 * transaction; it does NOT open one itself).
 *
 * Straight-line body: run the delete (if present) then the insert (if
 * present). NEVER opens a nested transaction — both sub-primitives
 * (`deleteRangeInTx`, `insertTextInTx`) are themselves in-transaction
 * primitives. This is what makes `replaceRangeInTx` safe to compose
 * inside an outer `applyOperation` (e.g. a batch op): the earlier code
 * called the PUBLIC `insertText` on the collapsed / null-plan branches,
 * which opened its own transaction → a reentrancy throw inside an open
 * tx. The plan folds those cases into `insertPlan` so we only ever call
 * `insertTextInTx` here.
 */
export function replaceRangeInTx(doc: Y.Doc, plan: ReplaceRangePlan): void {
  if (plan.deletePlan !== null) {
    deleteRangeInTx(doc, plan.deletePlan);
  }
  if (plan.insertPlan !== null) {
    insertTextInTx(doc, plan.insertPlan);
  }
}

/**
 * Validate `span` + `text` against `state` and produce a
 * `ReplaceRangePlan` (or `null` for the pure no-op cases). All validation
 * reads happen here, BEFORE the surrounding `applyOperation` is opened —
 * snapshot reads against the pre-mutation Y.Doc state.
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
 * in `planDeleteRange`, which runs after normalize.
 */
export function planReplaceRange(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): ReplaceRangePlan | null {
  const isCollapsed =
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset;

  // Collapsed span (no range to delete).
  if (isCollapsed) {
    // Pure no-op when there's also no text to insert.
    if (text === "") {
      return null;
    }
    // Insert-only path. The cursor is just span.anchor — no normalization
    // needed for a collapsed span. `planInsertText` validates the position
    // and may pick an in-place plan (safe: no prior delete in this tx blew
    // away the Y.Text identity).
    return {
      deletePlan: null,
      insertPlan: planInsertText(state, span.anchor, text, attrs, registry),
    };
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
  // after normalization — treat as no-op (no delete).
  const deletePlan = planDeleteRange(state, span, registry);

  // Delete-only path (insert is a no-op because text === "").
  if (text === "") {
    if (deletePlan === null) {
      return null;
    }
    return { deletePlan, insertPlan: null };
  }

  // Re-collapsed after normalization (e.g., reverse-order positions in the
  // same block at the same offset). The logical operation reduces to a pure
  // insert at the (collapsed) cursor position.
  if (deletePlan === null) {
    return {
      deletePlan: null,
      insertPlan: planInsertText(state, normalized.anchor, text, attrs, registry),
    };
  }

  // Full replace path: delete + insert, ONE transaction (T12).
  //
  // The insertion plan is built against `deletePlan.mergedItems` — the
  // anchor block's POST-DELETE inlineContent — and NOT against `state`
  // (whose snapshot of the anchor block is still pre-delete).
  // `deleteRangeInTx` will create a fresh Y.Array for the anchor block's
  // inlineContent inside the transaction; `insertTextInTx` will then
  // full-replace it again with the post-insert items. We use
  // `planInsertTextFullReplace` which forces mode=full-replace.
  const cursorOffset = normalized.anchor.offset;
  const anchorBlockId =
    deletePlan.mode === "same-block" ? deletePlan.blockId : deletePlan.anchorId;
  // Thread the span's owning tree (`deletePlan.kind`, resolved by
  // `planDeleteRange` via `resolveBlock`) into the insert plan so the
  // composed `insertTextInTx` full-replace writes into the correct Y.Map.
  // Both phases share the same anchor block, hence the same `kind`.
  const insertPlan = planInsertTextFullReplace(
    anchorBlockId,
    deletePlan.kind,
    deletePlan.mergedItems,
    cursorOffset,
    text,
    attrs,
    registry,
  );

  return { deletePlan, insertPlan };
}

import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import type { ReadonlyAttrs } from "../attrs";
import { inlineContentLength } from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { insertInlineText, requireYInline } from "../y-inline";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `insertTextInTx`: ONE offset insert of `text`
 * with COMPLETE `attrs` into the block's inline `Y.Text`. `kind` is the tree
 * (main / embedContents / templateContents) the block lives in, resolved once
 * during planning, so a caret inside a header/footer body mutates the OWNING map.
 */
export interface InsertTextPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly offset: number;
  readonly text: string;
  readonly attrs: ReadonlyAttrs;
  readonly registry?: AttrRegistry;
}

/**
 * Insert text into a leaf block's inline content at `position`.
 *
 * `attrs` is the COMPLETE attribute bag for the inserted text (caller computes
 * it from context, e.g. typing attrs). Returns OperationResult with
 * dirtyIds = { position.blockId }. Empty `text` is a no-op (original state).
 *
 * One offset `Y.Text.insert`: no existing character moves or is re-minted, so a
 * `RelativePosition` anywhere in the block survives. When `attrs` is
 * registry-equal to a non-marker neighbour's, the neighbour's stored value is
 * written (canonical storage — `insertInlineItems`).
 *
 * Throws if the block does not exist, is not a leaf, or `position.offset` is
 * outside `[0, inlineContentLength(content)]`.
 *
 * Composition: see `insertTextInTx` for the in-transaction primitive used by
 * `replaceRange` to compose delete + insert in a single Y.Doc transaction.
 */
export function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  if (text === "") {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const plan = planInsertText(state, position, text, attrs, registry);
  return applyOperation(state, (doc) => {
    insertTextInTx(doc, plan);
  });
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertTextPlan` to
 * `doc`. Caller owns validation and the surrounding transaction (this MUST run
 * inside an already-open transaction; it does NOT open one itself). Because the
 * write is a single offset insert, it composes after any prior in-tx op as long
 * as `plan.offset` is expressed against the block content at that point.
 */
export function insertTextInTx(doc: Y.Doc, plan: InsertTextPlan): void {
  requireInTransaction(doc, "insertText");
  const yBlock = getYBlock(doc, plan.blockId, "insertText", plan.kind);
  insertInlineText(requireYInline(yBlock, plan.blockId, "insertText"), plan.offset, plan.text, plan.attrs, plan.registry);
}

/**
 * Validate `position` + `text` against `state` and produce an `InsertTextPlan`.
 * All validation reads happen here, BEFORE the surrounding `applyOperation` is
 * opened. Throws on every condition `insertText`'s docstring lists.
 */
export function planInsertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  return planInsertTextAt(position.blockId, kind, position.offset, text, attrs, registry);
}

/**
 * Build an `InsertTextPlan` without validation, for composers that already know
 * the block + its content at application time (e.g. `replaceRange` after its
 * delete). Caller guarantees `offset` is within the block's content at that point.
 */
export function planInsertTextAt(
  blockId: BlockId,
  kind: BlockTreeKind,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  return { blockId, kind, offset, text, attrs, registry };
}

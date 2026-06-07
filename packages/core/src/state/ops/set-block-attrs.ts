import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import { getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYAttrs } from "../y-block";
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Replace a block's attrs with the given bag. Returns the new state and
 * a dirtyIds set containing the modified block id.
 *
 * No-op short-circuit (matches `mergeBlockAttrs`): when the new bag equals
 * the block's existing attrs we skip the Y.Map write, so `applyOperation`'s
 * no-op contract returns the input `state` reference unchanged (callers can
 * use `result.state === state` as an O(1) "did anything change?" guard).
 * Without this, a same-value `Y.Map.set("attrs", …)` fires a spurious change
 * event that dirties the block and cascades into re-render/re-layout.
 *
 * `registry` is consulted by `attrsEqual` for per-key custom equality (an
 * interpreter's `equals` overrides the default `deepValueEqual`) — e.g. a
 * `comment` attr whose `timestamp` field shouldn't affect "did anything
 * change?" decisions. Omitted → structural deep equality only. Callers from
 * the editor pass `config.attrRegistry`.
 *
 * Throws if the block does not exist.
 */
export function setBlockAttrs(
  state: State,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`setBlockAttrs: block "${blockId}" not found`);
  }
  const { block, kind } = resolved;
  return applyOperation(state, (doc) => {
    if (attrsEqual(block.attrs, attrs, registry)) {
      return;
    }
    const yBlock = getYBlock(doc, blockId, "setBlockAttrs", kind);
    yBlock.set("attrs", buildYAttrs(attrs));
  });
}

/**
 * In-transaction block-attr REPLACE primitive: write a main-tree block's attrs
 * bag inside an ALREADY-OPEN transaction. The in-tx counterpart of
 * `setBlockAttrs`, for composing an attr write into another op's single
 * transaction (one undo entry) WITHOUT reentering `applyOperation` — which would
 * trip the reentrancy dev-assert, or split the op into two undo entries.
 *
 * Used by the table column ops (`insertTableColumn` / `deleteTableColumn`) to
 * rewrite the table's `columnWidths` attr in the same tx as the cell mutations.
 * Main-tree only (the default `"block"` kind). No no-op short-circuit — callers
 * write only when the value actually changes (e.g. `columnWidths` present).
 */
export function setBlockAttrsInTx(
  doc: Y.Doc,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
  opName: string,
): void {
  requireInTransaction(doc, opName);
  getYBlock(doc, blockId, opName).set("attrs", buildYAttrs(attrs));
}

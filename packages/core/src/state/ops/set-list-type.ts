import type { BlockId, State, OperationResult } from "../index";
import { applyOperation } from "../state";
import { iterateBlocksInDocumentOrder } from "../document-order";
import { writeListDefInTx, type ListDef } from "../list-defs";

/**
 * Numbered-list definition: a decimal/lower-alpha alternation across nesting
 * levels (Google Docs' default ordered-list cycle). `after-break` restart so a
 * fresh consecutive run of items restarts numbering (per the list-collector's
 * break-before semantics).
 */
const ORDERED_DEF: ListDef = {
  levels: Array.from({ length: 9 }, (_v, i) => ({
    style: i % 2 === 0 ? "decimal" : "lower-alpha",
    start: 1,
    restart: "after-break",
  })),
};

/** Bulleted-list definition: disc/circle/square cycle (Google Docs' default). */
const UNORDERED_DEF: ListDef = {
  levels: Array.from({ length: 9 }, (_v, i) => ({
    style: i % 3 === 0 ? "disc" : i % 3 === 1 ? "circle" : "square",
    start: 1,
    restart: "after-break",
  })),
};

/**
 * Set the numbering style of an entire list (Google Docs: changing the list
 * type changes ALL its items). Writes the shared `ListDef` and contributes the
 * affected list-item BlockIds via the dirty-union channel — a listDefs-only
 * write captures no block dirty ids on its own, so without the returned set the
 * items would not re-render.
 *
 * The affected ids are collected from `state` BEFORE the transaction (a plain
 * document-order walk), which avoids reading raw Yjs attrs inside the op
 * closure. `block.attrs["listId"]` is read with a `typeof` guard — the same
 * untyped-attr access pattern the list-collector and cascade use.
 */
export function setListType(
  state: State,
  listId: string,
  listType: "ordered" | "unordered",
): OperationResult {
  const def = listType === "ordered" ? ORDERED_DEF : UNORDERED_DEF;
  const affected = new Set<BlockId>();
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.type !== "list-item") continue;
    const blockListId = block.attrs["listId"];
    if (typeof blockListId === "string" && blockListId === listId) {
      affected.add(block.id);
    }
  }
  return applyOperation(state, (doc) => {
    writeListDefInTx(doc, listId, def);
    return affected;
  });
}

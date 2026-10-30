import { ancestorChain, createPosition, createSpan, positionsEqual, resolveBlock } from "../state";
import type { State, Selection, Position, BlockId } from "../state";

/**
 * Keep a RANGE selection from partly covering a table (Google Docs / Word: once a
 * selection spans table content and content outside it, the whole table is
 * selected). An endpoint inside a table that does not also contain the other
 * endpoint is lifted to that table, `(tableId, 0)` — the OUTERMOST such table for
 * nested tables. A table endpoint covers its whole table (inclusive, as the start
 * or the end; see `isObjectBlock`). Sections are layout-transparent and never
 * lifted (a range across a section break stays a text range); atomic-leaf
 * endpoints stay as they are. A collapsed selection is never changed (a collapsed
 * `(atomic, 0)` is an object selection). Returns `selection` itself when nothing
 * moves. Cost: O(depth) per endpoint.
 */
export function normalizeSelectionForObjects(state: State, selection: Selection): Selection {
  if (positionsEqual(selection.anchor, selection.focus)) return selection;
  const anchorChain = ancestorChain(state, selection.anchor.blockId);
  const focusChain = ancestorChain(state, selection.focus.blockId);
  const anchor = liftOutOfTables(state, selection.anchor, anchorChain, focusChain);
  const focus = liftOutOfTables(state, selection.focus, focusChain, anchorChain);
  return anchor === selection.anchor && focus === selection.focus ? selection : createSpan(anchor, focus);
}

/** `pos` lifted to the outermost table among its ancestors that `otherChain` lacks, else `pos`. */
function liftOutOfTables(
  state: State,
  pos: Position,
  chain: readonly BlockId[],
  otherChain: readonly BlockId[],
): Position {
  // Root-first: the first table the other endpoint is not inside is the outermost.
  for (let i = chain.length - 1; i >= 0; i--) {
    const id = chain[i];
    if (id === undefined || otherChain.includes(id)) continue;
    if (resolveBlock(state, id)?.block.type !== "table") continue;
    return id === pos.blockId && pos.offset === 0 ? pos : createPosition(id, 0);
  }
  return pos;
}

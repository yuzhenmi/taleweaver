import {
  ancestorChain,
  createPosition,
  createSpan,
  firstTextAfter,
  inlineContentLength,
  isObjectBlock,
  positionsEqual,
  resolveBlock,
} from "../state";
import { findPrevContentBlock } from "./cursor-ops";
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
 * `(atomic, 0)` is an object selection). A table endpoint whose table holds the
 * other endpoint covers nothing outside it, so the range collapses to that other
 * endpoint (the reducer first restores the user's own anchor, `anchorBeforeLift`).
 * Returns `selection` itself when nothing moves. Cost: O(depth) per endpoint.
 */
export function normalizeSelectionForObjects(state: State, selection: Selection): Selection {
  if (positionsEqual(selection.anchor, selection.focus)) return selection;
  const anchorChain = ancestorChain(state, selection.anchor.blockId);
  const focusChain = ancestorChain(state, selection.focus.blockId);
  if (holdsOther(selection.anchor, focusChain)) return createSpan(selection.focus, selection.focus);
  if (holdsOther(selection.focus, anchorChain)) return createSpan(selection.anchor, selection.anchor);
  const anchor = liftOutOfTables(state, selection.anchor, anchorChain, focusChain);
  const focus = liftOutOfTables(state, selection.focus, focusChain, anchorChain);
  return anchor === selection.anchor && focus === selection.focus ? selection : createSpan(anchor, focus);
}

/** True when `pos` is a block endpoint `(id, 0)` whose subtree holds the other endpoint. */
function holdsOther(pos: Position, otherChain: readonly BlockId[]): boolean {
  return pos.offset === 0 && otherChain[0] !== pos.blockId && otherChain.includes(pos.blockId);
}

/**
 * Where a range's focus goes when extended off an object endpoint `(objectId, 0)`
 * (Shift+Arrow / Shift+Up/Down / Shift+Home/End): one step past the whole object —
 * forward to the start of the first text after it, backward to the end of the text
 * before it. `undefined` when `focus` is not an object endpoint; `null` at the
 * document edge.
 */
export function stepOffObject(
  state: State,
  focus: Position,
  direction: "forward" | "backward",
): Position | null | undefined {
  const block = resolveBlock(state, focus.blockId)?.block;
  if (block === undefined || focus.offset !== 0 || !isObjectBlock(block)) return undefined;
  if (direction === "forward") return firstTextAfter(state, block.id);
  const prev = findPrevContentBlock(state, block.id);
  const content = prev === null ? null : resolveBlock(state, prev)?.block.inlineContent ?? null;
  return prev === null || content === null ? null : createPosition(prev, inlineContentLength(content));
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

import {
  resolveBlock,
  blockMarkRanges,
  markEqualityOf,
  comparePositions,
  createPosition,
  createSpan,
  normalizeSpan,
  positionsEqual,
} from "../state";
import type { State, Position, Selection, Span } from "../state";
import type { AttrRegistry } from "../cascade/attr-registry";

/**
 * The atomic UNIT `pos` lies strictly inside, or null: the connected component of
 * overlapping atomic ranges containing it (grown to a fixpoint), so moving to
 * either edge of the unit can never land inside another atomic range. Ranges
 * that only touch (one ends where the next starts) are separate units — the
 * shared edge is a valid caret position.
 */
function atomicUnitAround(
  state: State,
  pos: Position,
  registry: AttrRegistry,
): { start: number; end: number } | null {
  const content = resolveBlock(state, pos.blockId)?.block.inlineContent ?? null;
  if (content === null) return null;
  const ranges = blockMarkRanges(content, (key) => registry.isAtomic(key), markEqualityOf(registry));
  let unit: { start: number; end: number } | null = null;
  for (const r of ranges) {
    if (r.start < pos.offset && pos.offset < r.end) {
      unit = unit === null ? { start: r.start, end: r.end } : { start: Math.min(unit.start, r.start), end: Math.max(unit.end, r.end) };
    }
  }
  if (unit === null) return null;
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of ranges) {
      if (r.start < unit.end && r.end > unit.start && (r.start < unit.start || r.end > unit.end)) {
        unit = { start: Math.min(unit.start, r.start), end: Math.max(unit.end, r.end) };
        grew = true;
      }
    }
  }
  return unit;
}

/**
 * Move one selection endpoint out of an atomic unit's interior.
 * - A caret or FOCUS that moved here from one edge of the unit (an arrow /
 *   Shift+arrow step into it, a drag crossing its edge) jumps to the OTHER edge —
 *   the direction of travel.
 * - Otherwise, in a range selection, the endpoint covers the unit: the earlier
 *   endpoint (`isStart`) goes to its start, the later to its end — so a drag or
 *   Shift+click that starts or ends inside includes the whole unit. The anchor
 *   always follows this rule (it does not travel).
 * - Otherwise a caret lands on the nearest edge (ties → end).
 */
function normalizeEndpoint(
  state: State,
  pos: Position,
  prev: Position,
  travels: boolean,
  collapsed: boolean,
  isStart: boolean,
  registry: AttrRegistry,
): Position {
  const r = atomicUnitAround(state, pos, registry);
  if (r === null) return pos;
  const fromEdge = travels && prev.blockId === pos.blockId && prev.offset !== pos.offset;
  let offset: number;
  if (fromEdge && prev.offset === r.start) offset = r.end;
  else if (fromEdge && prev.offset === r.end) offset = r.start;
  else if (!collapsed) offset = isStart ? r.start : r.end;
  else offset = pos.offset - r.start < r.end - pos.offset ? r.start : r.end;
  return createPosition(pos.blockId, offset);
}

/**
 * Keep `selection` out of atomic-mark interiors (the caret never rests inside an
 * atomic range; a range selection covers such a range whole or not at all).
 * `prev` is the selection before the action — its endpoints give the direction
 * of travel. Returns `selection` itself when nothing moves. Cost: one scan of the
 * focus (and anchor) block's items.
 */
export function normalizeSelectionForAtomicMarks(
  state: State,
  selection: Selection,
  prev: Selection,
  registry: AttrRegistry,
): Selection {
  const collapsed = positionsEqual(selection.anchor, selection.focus);
  if (collapsed) {
    const focus = normalizeEndpoint(state, selection.focus, prev.focus, true, true, false, registry);
    return focus === selection.focus ? selection : createSpan(focus, focus);
  }
  const focusFirst = comparePositions(state, selection.focus, selection.anchor) < 0;
  const anchor = normalizeEndpoint(state, selection.anchor, prev.anchor, false, false, !focusFirst, registry);
  const focus = normalizeEndpoint(state, selection.focus, prev.focus, true, false, focusFirst, registry);
  return anchor === selection.anchor && focus === selection.focus ? selection : createSpan(anchor, focus);
}

/**
 * `span` normalized to document order and grown so that no atomic mark is only
 * partly inside it — a delete touching part of an atomic unit (overlapping atomic
 * ranges count as one) removes all of it.
 */
export function expandSpanOverAtomicMarks(state: State, span: Span, registry: AttrRegistry): Span {
  const norm = normalizeSpan(state, span);
  if (!registry.hasAtomicMarks()) return norm;
  const s = atomicUnitAround(state, norm.anchor, registry);
  const e = atomicUnitAround(state, norm.focus, registry);
  if (s === null && e === null) return norm;
  return createSpan(
    s === null ? norm.anchor : createPosition(norm.anchor.blockId, s.start),
    e === null ? norm.focus : createPosition(norm.focus.blockId, e.end),
  );
}

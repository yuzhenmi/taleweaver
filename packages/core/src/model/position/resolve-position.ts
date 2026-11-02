import { valueEqual } from "../equality";
import type { InlineItem, ReadonlyAttrs } from "../block";
import type { Document } from "../document/types";
import { graphemeFloorAt } from "./graphemes";
import { type ItemRef, isFloat, itemAt, itemBefore, nextItem, prevItem, unitsOf } from "./items";
import { type ModelPosition, position } from "./model-position";
import { type ParagraphLayout, paragraphLayout } from "./paragraph-layout";

// ---------------------------------------------------------------------------
// Resolution (R14 / R15 / R16)
// ---------------------------------------------------------------------------

export interface PositionOptions {
  /** R14: mark keys whose maximal equal runs are atomic units (default: none). */
  readonly isAtomicMark?: (key: string) => boolean;
}

const present = (a: ReadonlyAttrs, k: string): boolean => a[k] !== undefined && a[k] !== null;

/** Two items share an equal (non-null) value of some atomic key: one atomic unit runs across them. */
function linked(a: InlineItem, b: InlineItem, isAtomic: (key: string) => boolean): boolean {
  for (const k of Object.keys(a.attrs)) if (present(a.attrs, k) && isAtomic(k) && valueEqual(a.attrs[k], b.attrs[k])) return true;
  return false;
}

const hasAtomic = (a: InlineItem, isAtomic: (key: string) => boolean): boolean => Object.keys(a.attrs).some((k) => present(a.attrs, k) && isAtomic(k));

/**
 * R14: the atomic UNIT `offset` lies strictly inside, or null: the maximal chain of
 * items, each sharing an equal value of an atomic key with the next — the union of
 * overlapping atomic ranges. Touching ranges of different values are separate units
 * (their shared edge is a valid position). Walks items outward from `offset` only.
 */
export function atomicUnitAround(L: ParagraphLayout, offset: number, isAtomic: (key: string) => boolean): { start: number; end: number } | null {
  const at = itemAt(L, offset);
  let left: ItemRef;
  let right: ItemRef;
  if (at !== null && at.start < offset) {
    if (!hasAtomic(at.item, isAtomic)) return null;
    left = at;
    right = at;
  } else {
    const b = itemBefore(L, offset);
    if (b === null || at === null || !linked(b.item, at.item, isAtomic)) return null;
    left = b;
    right = at;
  }
  for (let p = prevItem(L, left); p !== null && linked(p.item, left.item, isAtomic); p = prevItem(L, left)) left = p;
  for (let n = nextItem(L, right); n !== null && linked(right.item, n.item, isAtomic); n = nextItem(L, right)) right = n;
  return { start: left.start, end: right.start + unitsOf(right.item) };
}

/**
 * A valid caret offset of `offset` in paragraph `L`: clamped, then R15 (into a
 * grapheme cluster of the text item → its start), R16 (offsets around a float are
 * one position, the one before the float run), then R14 (inside an atomic mark run →
 * its nearest edge, ties → end), so R14 always holds.
 */
export function resolveOffset(L: ParagraphLayout, offset: number, opts: PositionOptions = {}): number {
  let off = Number.isFinite(offset) ? Math.min(Math.max(0, Math.trunc(offset)), L.length) : 0;
  off = graphemeFloorAt(L, off);
  for (let b = itemBefore(L, off); b !== null && isFloat(b.item); b = itemBefore(L, off)) off = b.start;
  const isAtomic = opts.isAtomicMark;
  if (isAtomic !== undefined) {
    const u = atomicUnitAround(L, off, isAtomic);
    if (u !== null) off = off - u.start < u.end - off ? u.start : u.end;
  }
  return off;
}

/** `resolveOffset` for a position of `d`; null when `pos.blockId` is not a paragraph. */
export function resolvePosition(d: Document, pos: ModelPosition, opts: PositionOptions = {}): ModelPosition | null {
  const L = paragraphLayout(d, pos.blockId);
  if (L === null) return null;
  const off = resolveOffset(L, pos.offset, opts);
  return off === pos.offset ? pos : position(pos.blockId, off);
}

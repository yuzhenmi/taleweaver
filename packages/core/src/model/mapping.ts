/**
 * Exact position mapping between versions (core-architecture D6 / D8), built from
 * the same Yjs deltas that drive change detection — no text diff, no heuristic.
 *
 * Each version the model derives is linked to the version it came from by a STEP:
 * the per-piece `Y.Text` deltas of the transaction. A position of version N maps to
 * N+1 by (1) its storage point in N's layout (`position.ts`), (2) that index through
 * its piece's delta, (3) the position at the new index in N+1's layout. A chain of
 * steps maps across many versions.
 *
 * Links run FORWARD (N → N+1) in a WeakMap keyed by the older version: HOLDING AN
 * OLD Document KEEPS THE WHOLE FORWARD CHAIN of later versions (and their deltas)
 * alive — needed to map from it — while the current version keeps nothing old alive. (A predecessor pointer on every
 * version would retain the whole history.) The `ModelChange` event still carries
 * `before` for consumers.
 *
 * Positions also survive arbitrarily long via Yjs RelativePositions
 * ({@link toRelativePosition} / {@link fromRelativePosition}).
 */
import * as Y from "yjs";
import type { Document } from "./derive";
import type { DeltaOp } from "./update";
import {
  type Assoc,
  type ModelPosition,
  type ParagraphLayout,
  type StoragePoint,
  paragraphLayout,
  pointAfter,
  pointBefore,
  positionAtPoint,
} from "./position";

export interface MappedPosition {
  /** The position in the target version, or null when it cannot be mapped (its storage left the document, or the step is unknown). */
  readonly position: ModelPosition | null;
  /** The content on the `assoc` side of the position was deleted on the way (or it could not be mapped). */
  readonly deleted: boolean;
}

interface Step {
  readonly next: Document;
  /** Per-piece deltas of the transaction; null = unknown (the root was replaced). */
  readonly deltas: ReadonlyMap<Y.Text, readonly DeltaOp[]> | null;
}

const steps = new WeakMap<Document, Step>();

/** Link `before` → `after` (called by the model once per derived version). */
export function recordStep(before: Document, after: Document, deltas: ReadonlyMap<Y.Text, readonly DeltaOp[]> | null): void {
  steps.set(before, { next: after, deltas });
}

const insertLength = (ins: unknown): number => (typeof ins === "string" ? ins.length : 1);

/** Map old storage index `i` of a piece through its delta. */
export function mapIndex(delta: readonly DeltaOp[], i: number, assoc: Assoc): { index: number; deleted: boolean } {
  let oldPos = 0;
  let newPos = 0;
  let deleted = false;
  for (const op of delta) {
    if (op.retain !== undefined) {
      if (i < oldPos + op.retain) return { index: newPos + (i - oldPos), deleted };
      oldPos += op.retain;
      newPos += op.retain;
    } else if (op.insert !== undefined) {
      if (i === oldPos && assoc < 0) return { index: newPos, deleted };
      newPos += insertLength(op.insert);
    } else if (op.delete !== undefined) {
      // Right before a deleted run, an assoc −1 position keeps its left side: not deleted.
      if (i === oldPos && assoc < 0) return { index: newPos, deleted };
      if (i < oldPos + op.delete) return { index: newPos, deleted: true };
      // The point sits right after the deleted run: the content on its left went.
      if (i === oldPos + op.delete) deleted ||= assoc < 0;
      oldPos += op.delete;
    }
  }
  return { index: newPos + (i - oldPos), deleted };
}

/** Map `pos` across one step from version `d`. */
function mapStep(d: Document, step: Step, pos: ModelPosition, assoc: Assoc): MappedPosition {
  const unmapped: MappedPosition = { position: null, deleted: true };
  if (step.deltas === null) return unmapped;
  const L = paragraphLayout(d, pos.blockId);
  const pt = L === null ? null : anchorPoint(L, pos.offset, assoc);
  if (L === null || pt === null) return unmapped;
  const delta = step.deltas.get(pt.piece);
  const m = delta === undefined ? { index: pt.index, deleted: false } : mapIndex(delta, pt.index, assoc);
  const fs = step.next.flows.get(L.fs.holderId);
  const out = fs === undefined ? null : positionAtPoint(step.next, fs, pt.piece, m.index, assoc);
  return out === null ? unmapped : { position: out, deleted: m.deleted };
}

/**
 * Map `pos` from version `from` to a later version `to` of the same model, step by
 * step. Unmappable when `to` is not reached from `from`.
 */
export function mapPosition(from: Document, to: Document, pos: ModelPosition, assoc: Assoc = 1): MappedPosition {
  let cur = from;
  let p: ModelPosition = pos;
  let deleted = false;
  while (cur !== to) {
    const step = steps.get(cur);
    if (step === undefined) return { position: null, deleted: true };
    const r = mapStep(cur, step, p, assoc);
    if (r.position === null) return r;
    p = r.position;
    deleted ||= r.deleted;
    cur = step.next;
  }
  return { position: p, deleted };
}

/**
 * The storage point a position is anchored at, by `assoc` — as a Yjs RelativePosition
 * anchors: `-1` after the unit before it, `1` at the unit after it. So content arriving
 * in a following (or fresh) piece moves the position exactly as within one piece.
 */
export function anchorPoint(L: ParagraphLayout, offset: number, assoc: Assoc): StoragePoint | null {
  return assoc < 0 ? pointAfter(L, offset) : pointBefore(L, offset);
}

/** A Yjs RelativePosition for `pos` of version `d` (null when `pos` is not a position of `d`). */
export function toRelativePosition(d: Document, pos: ModelPosition, assoc: Assoc = 1): Y.RelativePosition | null {
  const L = paragraphLayout(d, pos.blockId);
  const pt = L === null ? null : anchorPoint(L, pos.offset, assoc);
  return pt === null ? null : Y.createRelativePositionFromTypeIndex(pt.piece, pt.index, assoc < 0 ? -1 : 0);
}

/**
 * The position a RelativePosition names in version `d` (which must be the current
 * version of its document), unsnapped, or null when its piece is not read in `d`.
 * ponytail: finds the piece's flow by scanning the flows (O(flows)); index pieces by
 * flow if this runs per keystroke.
 */
export function fromRelativePosition(d: Document, rel: Y.RelativePosition, assoc: Assoc = 1): ModelPosition | null {
  const doc = d.docMap.doc;
  const abs = doc === null ? null : Y.createAbsolutePositionFromRelativePosition(rel, doc);
  const piece = abs?.type;
  if (abs === null || !(piece instanceof Y.Text)) return null;
  for (const [, fs] of d.flows.entries()) {
    if (!fs.segIndex.has(piece)) continue;
    return positionAtPoint(d, fs, piece, abs.index, assoc);
  }
  return null;
}

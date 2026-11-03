import { holdsAll } from "../document/blocks";
/**
 * Exact position mapping between versions (core-architecture D6 / D8), built from
 * the same Yjs deltas that drive change detection — no text diff, no heuristic.
 *
 * Each version the model derives is linked to the version it came from by a STEP:
 * the per-piece `Y.Text` deltas of the transaction. A position of version N maps to
 * N+1 by (1) its storage point in N's layout (`position/`), (2) that index through
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
import type * as Y from "yjs";
import type { Document } from "../document/types";
import { blockObjectAt } from "../position/block-object";
import { type Assoc, type ModelPosition, type ModelSelection, caretAt, isAllSelection, isObjectSelection } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { positionAtPoint, terminatorAtPoint } from "../position/position-at-point";
import { isBlockObject } from "../scan/kinds";
import type { DeltaOp } from "../update/flow-change";
import { anchorPoint } from "./relative-position";

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

/** Map storage index `index` of `piece` from version `from` to a later `to`, step by step; null when a step is unknown. */
function mapPoint(from: Document, to: Document, piece: Y.Text, index: number, assoc: Assoc): { index: number; deleted: boolean } | null {
  let cur = from;
  let i = index;
  let deleted = false;
  while (cur !== to) {
    const step = steps.get(cur);
    if (step === undefined || step.deltas === null) return null;
    const delta = step.deltas.get(piece);
    if (delta !== undefined) {
      const m = mapIndex(delta, i, assoc);
      i = m.index;
      deleted ||= m.deleted;
    }
    cur = step.next;
  }
  return { index: i, deleted };
}

/**
 * Map selection `sel` from version `from` to a later `to`; null when it cannot be mapped.
 * A text selection maps its ends (`assoc` −1, an end that cannot be mapped staying);
 * an object selection stays one while its object survives, else collapses to a caret
 * where the object was (`assoc` 1); a select-all stays while its flow exists.
 */
export function mapSelection(from: Document, to: Document, sel: ModelSelection): ModelSelection | null {
  if (isAllSelection(sel)) return holdsAll(to, sel.container) ? sel : null;
  if (isObjectSelection(sel)) {
    const o = blockObjectAt(from, sel.object);
    const m = o === null ? null : mapPoint(from, to, o.point.piece, o.point.index, 1);
    const fs = o === null ? undefined : to.flows.get(o.fs.holderId);
    if (o === null || m === null || fs === undefined) return null;
    const t = m.deleted ? null : terminatorAtPoint(fs, o.point.piece, m.index);
    if (t !== null && isBlockObject(t.token.k) && blockObjectAt(to, t.token.id) !== null) return { kind: "object", object: t.token.id };
    const p = positionAtPoint(to, fs, o.point.piece, m.index, 1);
    return p === null ? null : caretAt(p.blockId, p.offset);
  }
  const m = (p: ModelPosition): ModelPosition => mapPosition(from, to, p, -1).position ?? p;
  return { anchor: m(sel.anchor), focus: m(sel.focus) };
}

import * as Y from "yjs";
import type { Document, FlowState } from "../document/types";
import type { Assoc, ModelPosition } from "../position/model-position";
import { type ParagraphLayout, type StoragePoint, paragraphLayout } from "../position/paragraph-layout";
import { positionAtPoint } from "../position/position-at-point";
import { pointAfter, pointBefore } from "../position/storage-points";

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
 * The storage point a RelativePosition names in version `d` (which must be the current
 * version of its document), with the flow reading its piece; null when no flow reads it.
 * ponytail: finds the piece's flow by scanning the flows (O(flows)); index pieces by
 * flow if this runs per keystroke.
 */
export function pointOfRelative(d: Document, rel: Y.RelativePosition): { readonly fs: FlowState; readonly piece: Y.Text; readonly index: number } | null {
  const doc = d.docMap.doc;
  const abs = doc === null ? null : Y.createAbsolutePositionFromRelativePosition(rel, doc);
  const piece = abs?.type;
  if (abs === null || !(piece instanceof Y.Text)) return null;
  for (const [, fs] of d.flows.entries()) if (fs.segIndex.has(piece)) return { fs, piece, index: abs.index };
  return null;
}

/**
 * Whether the item `rel` is AT (assoc ≥ 0; Yjs following its `redone` chain to a re-created copy)
 * is live in `d`: Yjs resolves a live item's assoc −1 position one past its assoc ≥ 0 one, and a
 * deleted item's both to where it was.
 */
export function relativeItemLive(d: Document, rel: Y.RelativePosition): boolean {
  const doc = d.docMap.doc;
  if (doc === null || rel.item === null) return false;
  const at = Y.createAbsolutePositionFromRelativePosition(rel, doc);
  const after = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON({ ...Y.relativePositionToJSON(rel), assoc: -1 }), doc);
  return at !== null && after !== null && after.index === at.index + 1;
}

/** The position a RelativePosition names in version `d` (the current version of its document), unsnapped, or null when its piece is not read in `d`. */
export function fromRelativePosition(d: Document, rel: Y.RelativePosition, assoc: Assoc = 1): ModelPosition | null {
  const at = pointOfRelative(d, rel);
  return at === null ? null : positionAtPoint(d, at.fs, at.piece, at.index, assoc);
}

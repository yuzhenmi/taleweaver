import * as Y from "yjs";
import type { Document } from "../document/types";
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

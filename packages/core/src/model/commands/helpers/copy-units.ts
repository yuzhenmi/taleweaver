import * as Y from "yjs";
import type { FlowState } from "../../document/types";
import type { InsertUnit } from "../../plan";
import type { StoragePoint } from "../../position/paragraph-layout";
import { deepClone } from "../../storage/deep-clone";
import { zeroWidthPoints } from "./delete-range";

/**
 * G2: storage `[a, b)` of flow `fs` (a ≤ b) as insert units, read per segment: text with its formatting, item maps
 * deep-cloned (a footnote with its body, a nested table's marks). Zero-width anchors are not copied (they stay with the
 * original, or a command moves them: {@link anchorUnits}), nor JSON embeds; sub-flow items between segments are not
 * in the range.
 */
export function copyUnits(fs: FlowState, a: StoragePoint, b: StoragePoint): InsertUnit[] {
  return unitsOf(fs, a, b, keysOf(fs, a, b), false);
}

/** The zero-width units (anchor edges) of storage `[a, b)` of `fs`, deep-cloned (a marker is its `{ns, id, edge}`: the same anchor), in order. */
export function anchorUnits(fs: FlowState, a: StoragePoint, b: StoragePoint): InsertUnit[] {
  const keys = keysOf(fs, a, b);
  return keys.size === 0 ? [] : unitsOf(fs, a, b, keys, true); // no anchors: no piece delta read
}

/** The `seg:index` keys of the zero-width units of `[a, b)`. */
const keysOf = (fs: FlowState, a: StoragePoint, b: StoragePoint): ReadonlySet<string> => new Set(zeroWidthPoints(fs, a, b).map((p) => `${p.seg}:${p.index}`));

/** The units of `[a, b)` without the zero-width ones (`anchors` false), or just them (true). */
function unitsOf(fs: FlowState, a: StoragePoint, b: StoragePoint, zeroWidth: ReadonlySet<string>, anchors: boolean): InsertUnit[] {
  const deltas = new Map<Y.Text, unknown[]>();
  const out: InsertUnit[] = [];
  for (let j = a.seg; j <= b.seg; j++) {
    const seg = fs.segments[j];
    if (seg === undefined) continue;
    const from = j === a.seg ? a.index : seg.start;
    const to = j === b.seg ? b.index : seg.start + seg.len;
    if (to <= from) continue;
    const delta = deltas.get(seg.piece) ?? seg.piece.toDelta();
    deltas.set(seg.piece, delta);
    let at = 0;
    for (const op of delta) {
      if (at >= to) break;
      const { insert, attributes } = op as { insert?: unknown; attributes?: unknown };
      const attrs: Record<string, unknown> = typeof attributes === "object" && attributes !== null ? { ...attributes } : {};
      if (typeof insert === "string") {
        const text = !anchors ? insert.slice(Math.max(0, from - at), to - at) : "";
        if (text !== "") out.push({ text, attrs });
        at += insert.length;
      } else {
        if (at >= from && insert instanceof Y.Map && zeroWidth.has(`${j}:${at}`) === anchors) out.push({ embed: deepClone(insert), attrs });
        at += 1;
      }
    }
  }
  return out;
}

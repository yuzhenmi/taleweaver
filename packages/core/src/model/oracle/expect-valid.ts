import type { Document } from "../document/types";
import { resolvePosition } from "../position/resolve-position";
import { lengthOf } from "./document-probes";

// ---------------------------------------------------------------------------
// O2 validity
// ---------------------------------------------------------------------------

export function expectValid(d: Document): void {
  const seen = new Set<string>();
  for (const tree of ["block", "embedContent", "templateContent"] as const) {
    const t = d.trees[tree];
    for (const [id, b] of t.entries()) {
      if (seen.has(id)) throw new Error(`O2: id ${id} in two trees`);
      seen.add(id);
      if (b.parentId === null) continue;
      const parent = t.get(b.parentId);
      if (parent === undefined) throw new Error(`O2: ${id}'s parent ${b.parentId} is missing`);
      if ((b.prevSiblingId === null ? parent.firstChildId : t.get(b.prevSiblingId)?.nextSiblingId) !== id) throw new Error(`O2: ${id}'s prev link is broken`);
      if ((b.nextSiblingId === null ? parent.lastChildId : t.get(b.nextSiblingId)?.prevSiblingId) !== id) throw new Error(`O2: ${id}'s next link is broken`);
      if (b.inlineContent !== null) {
        const len = lengthOf(d, id);
        for (const offset of [0, len]) if (resolvePosition(d, { blockId: id, offset }) === null) throw new Error(`O2: ${id}:${offset} does not resolve`);
      }
    }
  }
}

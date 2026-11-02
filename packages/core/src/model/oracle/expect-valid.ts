import type { Document } from "../document/types";
import { resolvePosition } from "../position/resolve-position";
import { lengthOf } from "./document-probes";

// ---------------------------------------------------------------------------
// O2 validity
// ---------------------------------------------------------------------------

/** Every O2 violation of `d`, each tree checked in full. */
export function validityErrors(d: Document): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tree of ["block", "embedContent", "templateContent"] as const) {
    const t = d.trees[tree];
    for (const [id, b] of t.entries()) {
      if (seen.has(id)) out.push(`O2: id ${id} in two trees`);
      seen.add(id);
      if (b.parentId === null) continue;
      const parent = t.get(b.parentId);
      if (parent === undefined) {
        out.push(`O2: ${id}'s parent ${b.parentId} is missing`);
        continue;
      }
      if ((b.prevSiblingId === null ? parent.firstChildId : t.get(b.prevSiblingId)?.nextSiblingId) !== id) out.push(`O2: ${id}'s prev link is broken`);
      if ((b.nextSiblingId === null ? parent.lastChildId : t.get(b.nextSiblingId)?.prevSiblingId) !== id) out.push(`O2: ${id}'s next link is broken`);
      if (b.inlineContent !== null) {
        const len = lengthOf(d, id);
        for (const offset of [0, len]) if (resolvePosition(d, { blockId: id, offset }) === null) out.push(`O2: ${id}:${offset} does not resolve`);
      }
    }
  }
  return out;
}

export function expectValid(d: Document): void {
  const first = validityErrors(d)[0];
  if (first !== undefined) throw new Error(first);
}

import type { BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Document } from "../document/types";
import { type ModelSelection, position } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";

// ---------------------------------------------------------------------------
// Selections that start at a leading endpoint
// ---------------------------------------------------------------------------

/** Select-all of a flow (default the body): from before any leading block objects to the end of its last paragraph. */
export function selectAll(d: Document, holderId: BlockId = d.rootId): ModelSelection | null {
  const fs = d.flows.get(holderId);
  if (fs === undefined) return null;
  const tree = d.trees[fs.tree];
  const containers = fs.isRoot ? fs.sections.map((s) => s.id) : [holderId];
  let first: BlockId | null = null;
  let last: BlockId | null = null;
  for (const c of containers) {
    for (let id = tree.get(c)?.firstChildId ?? null; id !== null; id = tree.get(id)?.nextSiblingId ?? null) {
      if (tree.get(id)?.inlineContent === null) continue;
      first ??= id;
      last = id;
    }
  }
  const L = last === null ? null : paragraphLayout(d, last);
  if (first === null || L === null) return null;
  return { anchor: { blockId: first, offset: 0, leading: true }, focus: position(L.block.id, L.length) };
}

/** A TOC's object selection: the range over the block objects directly before the paragraph after it. */
export function objectSelection(d: Document, tocId: BlockId): ModelSelection | null {
  const next = resolveBlock(d, tocId)?.block.nextSiblingId ?? null;
  let id = next;
  while (id !== null && resolveBlock(d, id)?.block.inlineContent === null) id = resolveBlock(d, id)?.block.nextSiblingId ?? null;
  if (id === null) return null;
  return { anchor: { blockId: id, offset: 0, leading: true }, focus: position(id, 0) };
}

import { type Block, type BlockId, EMBED_TYPES } from "../block";
import { unitsOf } from "../position/items";
import { getTemplateContentIds } from "./blocks";
import type { Document } from "./types";

/** The blocks of one flow in reading order (children of its sections / holder). */
function* flowBlocks(d: Document, holderId: BlockId): Generator<Block> {
  const fs = d.flows.get(holderId);
  if (fs === undefined) return;
  const tree = d.trees[fs.tree];
  const containers = fs.isRoot ? fs.sections.map((s) => s.id) : [holderId];
  for (const c of containers) {
    for (let id = tree.get(c)?.firstChildId ?? null; id !== null; ) {
      const b = tree.get(id);
      if (b === undefined) break;
      yield b;
      id = b.nextSiblingId;
    }
  }
}

/** Every flow in document order (see {@link markerRanges}). */
function flowsInDocumentOrder(d: Document): BlockId[] {
  const out: BlockId[] = [];
  const visit = (holderId: BlockId): void => {
    if (!d.flows.has(holderId)) return;
    out.push(holderId);
    for (const b of flowBlocks(d, holderId)) {
      // A table's cell flows, row-major (rendered cells only), in place.
      for (const cell of d.tables.get(b.id)?.cells ?? []) visit(cell.id);
      for (const item of b.inlineContent?.items ?? []) {
        const body = item.kind === "embed" && item.embedType === EMBED_TYPES.footnoteAnchor ? item.properties["contentBlockId"] : undefined;
        if (typeof body === "string") visit(body);
      }
    }
  };
  visit(d.rootId);
  for (const id of getTemplateContentIds(d)) visit(id);
  return out;
}

export interface MarkerPoint {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface MarkerRange {
  readonly ns: string;
  readonly id: string;
  readonly start: MarkerPoint;
  readonly end: MarkerPoint;
}

const markerMemo = new WeakMap<Document, ReadonlyMap<string, MarkerRange>>();

export const markerKey = (ns: string, id: string): string => `${ns}\u0000${id}`;

/**
 * R12: per (ns, id), the first start pairs with the first end after it in the same
 * flow; every other marker of that key is inert. Flows are taken in document order —
 * the body flow, then header / footer bodies by id — each followed (depth first) by
 * the footnote bodies it anchors, in anchor order, and its tables' cell flows
 * (row-major, at the table's place); the first flow that pairs a key
 * wins. Keyed by {@link markerKey}.
 * ponytail: one O(document) walk per version, memoized; index markers per block if a
 * per-keystroke consumer appears.
 */
export function markerRanges(d: Document): ReadonlyMap<string, MarkerRange> {
  const memo = markerMemo.get(d);
  if (memo !== undefined) return memo;
  const out = new Map<string, MarkerRange>();
  for (const holderId of flowsInDocumentOrder(d)) {
    const open = new Map<string, MarkerPoint>();
    for (const b of flowBlocks(d, holderId)) {
      let offset = 0;
      for (const item of b.inlineContent?.items ?? []) {
        if (item.kind === "embed" && item.embedType === EMBED_TYPES.marker) {
          const ns = String(item.properties["ns"]);
          const id = String(item.properties["id"]);
          const key = markerKey(ns, id);
          const at = { blockId: b.id, offset };
          if (!out.has(key)) {
            if (item.properties["edge"] === "start") {
              if (!open.has(key)) open.set(key, at);
            } else {
              const start = open.get(key);
              if (start !== undefined) out.set(key, { ns, id, start, end: at });
            }
          }
        }
        offset += unitsOf(item);
      }
    }
  }
  markerMemo.set(d, out);
  return out;
}

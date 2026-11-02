/**
 * Read API over a version (names kept from `state/document.ts`).
 */
import type { Block, BlockId } from "./block";
import { EMBED_TYPES } from "./block";
import { DEFAULT_LIST_LEVEL, type Document, type ListLevelDef, type TreeKind } from "./derive";

export type { Document, ListDef, ListLevelDef, TreeKind } from "./derive";

export function getBlock(d: Document, id: BlockId): Block | null {
  return d.trees.block.get(id) ?? null;
}

export function getEmbedContent(d: Document, id: BlockId): Block | null {
  return d.trees.embedContent.get(id) ?? null;
}

export function getTemplateContent(d: Document, id: BlockId): Block | null {
  return d.trees.templateContent.get(id) ?? null;
}

export interface ResolvedBlock {
  readonly block: Block;
  readonly kind: TreeKind;
}

/** A block from any tree (precedence: main, embed contents, template contents). */
export function resolveBlock(d: Document, id: BlockId): ResolvedBlock | null {
  for (const kind of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    const block = d.trees[kind].get(id);
    if (block !== undefined) return { block, kind };
  }
  return null;
}

/** `resolveBlock(...)?.block`, `undefined` when absent (a version is complete: absent means absent). */
export function peekBlock(d: Document, id: BlockId): Block | undefined {
  return resolveBlock(d, id)?.block;
}

function flowIdsOf(d: Document, tree: TreeKind): BlockId[] {
  const out: BlockId[] = [];
  for (const [id, fs] of d.flows.entries()) if (fs.tree === tree) out.push(id);
  return out.sort();
}

/** Root ids of the footnote bodies (sorted: independent of map order). */
export function getEmbedContentIds(d: Document): BlockId[] {
  return flowIdsOf(d, "embedContent");
}

/** Root ids of the header / footer bodies (sorted). */
export function getTemplateContentIds(d: Document): BlockId[] {
  return flowIdsOf(d, "templateContent");
}

/** Highest list level a paragraph can have. */
export const MAX_LIST_LEVEL = 8;

/** R11: the level config of `level` in list `listId`: a missing def → default; level clamped to min(level, levels − 1, 8). */
export function listLevelConfig(d: Document, listId: string, level: number): ListLevelDef {
  const def = d.listDefs.get(listId);
  if (def === undefined || def.levels.length === 0) return DEFAULT_LIST_LEVEL;
  const l = Math.max(0, Math.min(Number.isInteger(level) ? level : 0, def.levels.length - 1, MAX_LIST_LEVEL));
  return def.levels[l] ?? DEFAULT_LIST_LEVEL;
}

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
 * the footnote bodies it anchors, in anchor order; the first flow that pairs a key
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
        offset += item.kind === "text" ? item.text.length : 1;
      }
    }
  }
  markerMemo.set(d, out);
  return out;
}

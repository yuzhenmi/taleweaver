import { BLOCK_TYPES, type Block, type BlockId, type ReadonlyAttrs } from "../block";
import { scalarsWithPrefix } from "../storage/map-reads";
import type { ParaEntity, TocEntity } from "./entities";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Block types a `p:type` can never name: they belong to containers / block objects,
 * so a ¶ carrying one reads as a plain paragraph.
 */
export const RESERVED_TYPES: ReadonlySet<string> = new Set([
  BLOCK_TYPES.document,
  BLOCK_TYPES.section,
  BLOCK_TYPES.tableOfContents,
  BLOCK_TYPES.templateBody,
  BLOCK_TYPES.footnoteBody,
  BLOCK_TYPES.table,
  BLOCK_TYPES.tableRow,
  BLOCK_TYPES.tableCell,
  "image",
  "horizontal-line",
]);

export const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

export interface Links {
  readonly parentId: BlockId | null;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

/** A paragraph or TOC record (a table's is `derive-flow.ts` `tableRecord`). */
export function entityRecord(e: ParaEntity | TocEntity, links: Links): Block {
  if (e.k === "toc") {
    return Object.freeze({
      id: e.id,
      type: BLOCK_TYPES.tableOfContents,
      attrs: Object.freeze(scalarsWithPrefix(e.map, "a:")),
      ...links,
      firstChildId: null,
      lastChildId: null,
      inlineContent: null,
    });
  }
  const base = {
    id: e.id,
    ...links,
    firstChildId: null,
    lastChildId: null,
    inlineContent: Object.freeze({ items: Object.freeze(e.items.slice()) }),
  };
  if (e.map === null) return Object.freeze({ ...base, type: BLOCK_TYPES.paragraph, attrs: EMPTY_ATTRS });
  const p = scalarsWithPrefix(e.map, "p:");
  const rawType = p["type"];
  const type = typeof rawType === "string" && rawType !== "" && !RESERVED_TYPES.has(rawType) ? rawType : BLOCK_TYPES.paragraph;
  delete p["type"];
  const m = scalarsWithPrefix(e.map, "m:");
  const ins = e.map.get("t:ins");
  const del = e.map.get("t:del");
  const bs = {
    ...(typeof ins === "string" ? { insertionId: ins } : {}),
    ...(typeof del === "string" ? { deletionId: del } : {}),
  };
  return Object.freeze({
    ...base,
    type,
    attrs: Object.freeze(p),
    ...(Object.keys(m).length > 0 ? { markAttrs: Object.freeze(m) } : {}),
    ...(Object.keys(bs).length > 0 ? { breakSuggestion: Object.freeze(bs) } : {}),
  });
}

/** An empty section record (attrs and sibling links come from {@link writeSections}). */
export function sectionRecord(id: BlockId, rootId: BlockId): Block {
  return containerRecord(id, BLOCK_TYPES.section, EMPTY_ATTRS, { parentId: rootId, prevSiblingId: null, nextSiblingId: null }, null, null);
}

export function containerRecord(id: BlockId, type: string, attrs: ReadonlyAttrs, links: Links, first: BlockId | null, last: BlockId | null): Block {
  return Object.freeze({ id, type, attrs, ...links, firstChildId: first, lastChildId: last, inlineContent: null });
}

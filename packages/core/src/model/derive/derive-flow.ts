import * as Y from "yjs";
import { BLOCK_TYPES, type Block, type BlockId, EMBED_TYPES, type ReadonlyAttrs } from "../block";
import type { FlowState, SectionInfo, TreeKind } from "../document/types";
import { finalSectionId, flowEndId, footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import { isText } from "../scan/kinds";
import type { FootnoteRef, ScanCtx, Segment } from "../scan/tokens";
import { flowOf, scalarsWithPrefix } from "../storage/map-reads";
import { type BlockEntity, type Entity, type ParaEntity, type SectionBreakEntity, type TableEntity, flatten, indexSegments, isBlockEntity, isParaEntity, isSectionBreakEntity } from "./entities";
import { EMPTY_ATTRS, type Links, containerRecord, entityRecord } from "./records";
import { writeSections } from "./sections";
import type { FormedRow, FormedTable } from "./table/form-table";
import { withInertMarks } from "./table/inert-marks";
import type { TableForm } from "./table/table-form";
import { PMap } from "../pmap";
import { parseFlow } from "./table/parse-tables";
import type { Working } from "./working";

// ---------------------------------------------------------------------------
// Flow derivation
// ---------------------------------------------------------------------------

export function piecesOf(arr: Y.Array<Y.Text> | null): Y.Text[] {
  if (arr === null) return [];
  const out: Y.Text[] = [];
  for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}


/** Split entities at `[S]`s: segments[i] ends at breaks[i]; the last segment ends the flow. */
export function segmentsOf(ents: readonly Entity[]): { segments: BlockEntity[][]; breaks: SectionBreakEntity[] } {
  const segments: BlockEntity[][] = [[]];
  const breaks: SectionBreakEntity[] = [];
  for (const e of ents) {
    if (isSectionBreakEntity(e)) {
      breaks.push(e);
      segments.push([]);
    } else {
      const seg = segments[segments.length - 1];
      if (seg !== undefined) seg.push(e);
    }
  }
  return { segments, breaks };
}

/** Write a segment's records (siblings of one container), `prev` / `next` at its ends. */
export function writeSegment(w: Working, tree: TreeKind, seg: readonly BlockEntity[], parentId: BlockId, prev: BlockId | null, next: BlockId | null): void {
  for (let i = 0; i < seg.length; i++) {
    const e = seg[i];
    if (e === undefined) continue;
    const links: Links = {
      parentId,
      prevSiblingId: i === 0 ? prev : (seg[i - 1]?.id ?? null),
      nextSiblingId: i === seg.length - 1 ? next : (seg[i + 1]?.id ?? null),
    };
    if (e.k === "table") writeTable(w, tree, e, links);
    else w.put(tree, entityRecord(e, links));
  }
}

/** The scan context of a flow in `tree`: footnote anchors are read only in the main tree. */
export function scanCtxOf(w: Working, tree: TreeKind): ScanCtx {
  return { registry: w.registry, footnotes: tree === "block" };
}

/** A non-root flow's holder record fields (default: a template / footnote body with no parent). */
export interface HolderRecord {
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly links: Links;
}

const NO_LINKS: Links = Object.freeze({ parentId: null, prevSiblingId: null, nextSiblingId: null });

/**
 * Derive one flow from scratch (with its tables, and recursively the footnote bodies its
 * paragraphs anchor). `holder`: a non-root holder's record fields (type, attrs, links).
 */
export function deriveFlow(w: Working, holderId: BlockId, tree: TreeKind, array: Y.Array<Y.Text> | null, isRoot: boolean, holder?: HolderRecord): void {
  const flowSegments: Segment[] = [];
  const ctx = scanCtxOf(w, tree);
  for (const p of piecesOf(array)) flattenPiece(p, ctx, flowSegments);
  const parsed = parseFlow(flatten(flowSegments), holderId);
  let ents = parsed.ents;
  if (!isRoot) ents = ents.filter(isBlockEntity);
  const synthetic = !ents.some(isBlockEntity);
  if (synthetic) ents.push({ k: "para", id: flowEndId(holderId), map: null, items: [], footnotes: [] });
  const { segments, breaks } = segmentsOf(ents);
  const sections: SectionInfo[] = isRoot
    ? [...breaks.map((b) => ({ id: sectionIdOf(b.id), map: b.map })), { id: finalSectionId(w.rootId), map: w.docMap }]
    : [];
  if (isRoot) {
    segments.forEach((seg, i) => {
      const sec = sections[i];
      if (sec === undefined) return;
      writeSegment(w, tree, seg, sec.id, null, null);
      w.put(tree, containerRecord(sec.id, BLOCK_TYPES.section, EMPTY_ATTRS, { parentId: holderId, prevSiblingId: null, nextSiblingId: null }, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
    });
  } else {
    const seg = segments[0] ?? [];
    writeSegment(w, tree, seg, holderId, null, null);
    const type = holder?.type ?? (tree === "templateContent" ? BLOCK_TYPES.templateBody : BLOCK_TYPES.footnoteBody);
    w.put(tree, containerRecord(holderId, type, holder?.attrs ?? EMPTY_ATTRS, holder?.links ?? NO_LINKS, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
  }
  const read = withInertMarks(flowSegments, parsed.inert);
  let tables = PMap.empty<TableForm>();
  for (const [id, f] of parsed.tables) tables = tables.set(id, f);
  w.flows = w.flows.set(holderId, { holderId, tree, isRoot, array, segments: read, segIndex: indexSegments(read), sections, synthetic, tables, leadsAfter: parsed.leadsAfter });
  w.fresh.add(holderId);
  if (isRoot) writeSections(w);
  for (const p of parasOf(ents)) for (const f of p.footnotes) deriveFootnote(w, f);
}

/** The paragraph entities of `ents`, those in table cells included (reading order). */
export function* parasOf(ents: readonly Entity[]): Generator<ParaEntity> {
  for (const e of ents) {
    if (isParaEntity(e)) yield e;
    else if (e.k === "table") for (const r of e.formed?.rows ?? []) for (const c of r.cells) yield* parasOf(c.ents);
  }
}

// ---------------------------------------------------------------------------
// Tables: the table, row and cell records (the grid is formed by `table/`)
// ---------------------------------------------------------------------------

/** Write table `e`'s record (with `links`) and its rows, cells and cell contents. */
function writeTable(w: Working, tree: TreeKind, e: TableEntity, links: Links): void {
  const formed = e.formed;
  if (formed === null) throw new Error(`model: table ${e.id} written unformed`);
  w.put(tree, tableRecord(e, formed, links));
  formed.rows.forEach((row, r) => writeRow(w, tree, row, { parentId: e.id, prevSiblingId: formed.rows[r - 1]?.id ?? null, nextSiblingId: formed.rows[r + 1]?.id ?? null }));
}

/** Write a table row's record (with `links`) and its cells and their contents. */
export function writeRow(w: Working, tree: TreeKind, row: FormedRow, links: Links): void {
  row.cells.forEach((cell, j) => {
    const cellLinks: Links = { parentId: row.id, prevSiblingId: row.cells[j - 1]?.id ?? null, nextSiblingId: row.cells[j + 1]?.id ?? null };
    w.put(tree, containerRecord(cell.id, BLOCK_TYPES.tableCell, cellAttrs(cell.map, cell.rowSpan, cell.colSpan), cellLinks, cell.ents[0]?.id ?? null, cell.ents[cell.ents.length - 1]?.id ?? null));
    writeSegment(w, tree, cell.ents, cell.id, null, null);
  });
  w.put(tree, containerRecord(row.id, BLOCK_TYPES.tableRow, Object.freeze(scalarsWithPrefix(row.map, "a:")), links, row.cells[0]?.id ?? null, row.cells[row.cells.length - 1]?.id ?? null));
}

/** The table's record: `a:*` + `columnWidths` (RT3) + `headerRowCount` (RT4, when > 0). */
function tableRecord(e: TableEntity, formed: FormedTable, links: Links): Block {
  const attrs = scalarsWithPrefix(e.map, "a:");
  delete attrs["columnWidths"];
  delete attrs["headerRowCount"];
  if (formed.widths !== null) attrs["columnWidths"] = formed.widths;
  if (formed.headerCount > 0) attrs["headerRowCount"] = formed.headerCount;
  return containerRecord(e.id, BLOCK_TYPES.table, Object.freeze(attrs), links, formed.rows[0]?.id ?? null, formed.rows[formed.rows.length - 1]?.id ?? null);
}

/** A cell's `a:*`, with `rowSpan` / `colSpan` set only when > 1 (a virtual cell has none). */
function cellAttrs(map: Y.Map<unknown> | null, rowSpan: number, colSpan: number): ReadonlyAttrs {
  const a = map === null ? {} : scalarsWithPrefix(map, "a:");
  delete a["rowSpan"];
  delete a["colSpan"];
  if (rowSpan > 1) a["rowSpan"] = rowSpan;
  if (colSpan > 1) a["colSpan"] = colSpan;
  return Object.freeze(a);
}

/**
 * Remove the records under block `id` (a table's rows, cells and their contents), with the footnote bodies they
 * anchor unless `bodies` is false (the caller diffs those).
 */
export function removeDescendants(w: Working, tree: TreeKind, id: BlockId, bodies = true): void {
  let c = w.get(tree, id)?.firstChildId ?? null;
  while (c !== null) {
    const b = w.get(tree, c);
    if (b === undefined) break;
    if (bodies) for (const body of footnoteBodiesOf(b)) removeFlow(w, body);
    removeDescendants(w, tree, c, bodies);
    w.del(tree, c);
    c = b.nextSiblingId;
  }
}

export function deriveFootnote(w: Working, f: FootnoteRef): void {
  deriveFlow(w, footnoteBodyId(f.id), "embedContent", f.body === null ? null : flowOf(f.body), false);
}

/** The footnote body ids anchored by a block's inline content. */
export function footnoteBodiesOf(b: Block | undefined): BlockId[] {
  const out: BlockId[] = [];
  for (const item of b?.inlineContent?.items ?? []) {
    // Footnote body ownership (kind-internal: the anchor owns its body, X20).
    if (!isText(item) && item.embedType === EMBED_TYPES.footnoteAnchor) {
      const id = item.properties["contentBlockId"];
      if (typeof id === "string") out.push(id);
    }
  }
  return out;
}

/** Every container of a flow: the sections + root, or the holder. */
function containersOf(fs: FlowState): BlockId[] {
  return fs.isRoot ? fs.sections.map((s) => s.id) : [fs.holderId];
}

/** Remove a flow's records (and, recursively, its tables and the footnote bodies it anchors). */
export function removeFlow(w: Working, holderId: BlockId): void {
  const fs = w.flows.get(holderId);
  if (fs === undefined) return;
  for (const c of containersOf(fs)) {
    let id = w.get(fs.tree, c)?.firstChildId ?? null;
    while (id !== null) {
      const b = w.get(fs.tree, id);
      if (b === undefined) break;
      for (const body of footnoteBodiesOf(b)) removeFlow(w, body);
      removeDescendants(w, fs.tree, id);
      w.del(fs.tree, id);
      id = b.nextSiblingId;
    }
    w.del(fs.tree, c);
  }
  if (fs.isRoot) w.del(fs.tree, fs.holderId);
  w.flows = w.flows.delete(holderId);
}

import * as Y from "yjs";
import { BLOCK_TYPES, type Block, type BlockId, EMBED_TYPES, type ReadonlyAttrs } from "../block";
import type { FlowState, SectionInfo, TableCellInfo, TableRowInfo, TableState, TreeKind } from "../document/types";
import { cellId, finalSectionId, flowEndId, footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import { isText } from "../scan/kinds";
import type { FootnoteRef, ScanCtx, Segment } from "../scan/tokens";
import { typeId } from "../storage/item-id";
import { TRACK_KEY } from "../storage/keys";
import { flowOf, scalarsWithPrefix } from "../storage/map-reads";
import { cellFlowOf } from "../storage/table-keys";
import { type BlockEntity, type Entity, type SectionBreakEntity, flatten, group, indexSegments, isBlockEntity, isParaEntity, isSectionBreakEntity, isTableEntity } from "./entities";
import { EMPTY_ATTRS, type Links, containerRecord, entityRecord } from "./records";
import { writeSections } from "./sections";
import { cellAttrs, readTable } from "./table/read-table";
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
    if (!isTableEntity(e)) {
      w.put(tree, entityRecord(e, links));
      continue;
    }
    const ts = w.tables.get(e.id);
    if (ts === undefined) throw new Error(`model: table ${e.id} written before it was read`);
    w.put(tree, tableRecord(ts, links));
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
 * Derive one flow from scratch (and, recursively, the tables it holds and the footnote
 * bodies its paragraphs anchor). `holder`: a cell's record fields (type, attrs, links).
 */
export function deriveFlow(w: Working, holderId: BlockId, tree: TreeKind, array: Y.Array<Y.Text> | null, isRoot: boolean, holder?: HolderRecord): void {
  const flowSegments: Segment[] = [];
  const ctx = scanCtxOf(w, tree);
  for (const p of piecesOf(array)) flattenPiece(p, ctx, flowSegments);
  let ents = group(flatten(flowSegments), true, holderId);
  if (!isRoot) ents = ents.filter(isBlockEntity);
  const synthetic = !ents.some(isBlockEntity);
  if (synthetic) ents.push({ k: "para", id: flowEndId(holderId), map: null, items: [], footnotes: [] });
  for (const e of ents) if (isTableEntity(e)) regridTable(w, e.id, e.map, tree);
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
  w.flows = w.flows.set(holderId, { holderId, tree, isRoot, array, segments: flowSegments, segIndex: indexSegments(flowSegments), sections, synthetic });
  w.fresh.add(holderId);
  if (isRoot) writeSections(w);
  for (const e of ents) if (isParaEntity(e)) for (const f of e.footnotes) deriveFootnote(w, f);
}

// ---------------------------------------------------------------------------
// Tables: rows, cells and cell flows; the read is `table/read-table.ts`
// ---------------------------------------------------------------------------

const linksOf = (b: Block): Links => ({ parentId: b.parentId, prevSiblingId: b.prevSiblingId, nextSiblingId: b.nextSiblingId });

/** Write a cell: an unchanged flow array keeps its FlowState (the record is re-put), any other is derived. */
function putCell(w: Working, id: BlockId, tree: TreeKind, array: Y.Array<Y.Text> | null, attrs: ReadonlyAttrs, links: Links): void {
  const old = w.get(tree, id);
  if (old !== undefined && w.flows.get(id)?.array === array) {
    w.put(tree, Object.freeze({ ...old, ...links, attrs }));
    return;
  }
  removeFlow(w, id);
  deriveFlow(w, id, tree, array, false, { type: BLOCK_TYPES.tableCell, attrs, links });
}

const NO_ROWS: ReadonlySet<Y.Map<unknown>> = new Set();

/**
 * (Re-)read table `id` (in `tree`) and write the row and cell records and cell flows of
 * its regrid band (`table/band.ts`): a cell whose RowMap, spans and siblings are
 * unchanged is left alone, one whose flow array is unchanged keeps its FlowState; vanished
 * cells / rows are removed first. `touched`: RowMaps whose grid keys changed. With no old
 * state this is the from-scratch derivation; the table record itself is written with its
 * flow siblings ({@link tableRecord}), or re-put here with its links when the table was
 * already read.
 */
export function regridTable(w: Working, id: BlockId, map: Y.Map<unknown>, tree: TreeKind, touched: ReadonlySet<Y.Map<unknown>> = NO_ROWS): void {
  const old = w.tables.get(id);
  const { ts, band, prior, goneRows } = readTable(old, id, map, tree, touched);
  w.tables = w.tables.set(id, ts);
  w.fresh.add(id);
  // The band's cells to write: a cell whose RowMap, spans and siblings are unchanged is left alone.
  const writes: { row: TableRowInfo; cell: TableCellInfo; links: Links; flow: Y.Array<Y.Text> | null }[] = [];
  const live = new Set<BlockId>();
  for (const r of band) {
    const row = ts.rows[r];
    const cells = ts.rowCells[r] ?? [];
    cells.forEach((cell, j) => {
      live.add(cell.id);
      const prevId = cells[j - 1]?.id ?? null;
      const nextId = cells[j + 1]?.id ?? null;
      const p = prior.get(cell.id);
      if (row === undefined || (p !== undefined && p.row === row.map && p.cell.rowSpan === cell.rowSpan && p.cell.colSpan === cell.colSpan && p.prev === prevId && p.next === nextId)) return;
      writes.push({ row, cell, links: { parentId: row.id, prevSiblingId: prevId, nextSiblingId: nextId }, flow: cellFlowOf(row.map, cell.colKey) });
    });
  }
  // Removals first: blocks move between cell ids (a key change, a duplicate revealed), so every
  // vanished cell and every cell whose flow array changes lets go of its blocks before any is derived.
  for (const cellIdOld of prior.keys()) if (!live.has(cellIdOld)) removeFlow(w, cellIdOld);
  for (const x of writes) if (w.flows.get(x.cell.id)?.array !== x.flow) removeFlow(w, x.cell.id);
  for (const rowId of goneRows) w.del(tree, rowId);
  for (const x of writes) putCell(w, x.cell.id, tree, x.flow, cellAttrs(x.row.map, x.cell.colKey, x.cell.rowSpan, x.cell.colSpan), x.links);
  for (const r of band) {
    const row = ts.rows[r];
    const cells = ts.rowCells[r];
    if (row === undefined || cells === undefined) continue;
    w.put(
      tree,
      containerRecord(
        row.id,
        BLOCK_TYPES.tableRow,
        Object.freeze(scalarsWithPrefix(row.map, "a:")),
        { parentId: id, prevSiblingId: ts.rows[r - 1]?.id ?? null, nextSiblingId: ts.rows[r + 1]?.id ?? null },
        cells[0]?.id ?? null,
        cells[cells.length - 1]?.id ?? null,
      ),
    );
  }
  if (old === undefined) return;
  const rec = w.get(tree, id);
  if (rec !== undefined) w.put(tree, tableRecord(ts, linksOf(rec)));
}

const spanOf = (v: unknown): number => (typeof v === "number" ? v : 1);

/**
 * A RowMap's `c:<col>:flow` / `c:<col>:a:*` changed (they never change the grid, R7):
 * re-put that cell's record, or derive its flow when the array changed. Not a rendered
 * cell of `row` (covered, a duplicate row, an orphan column), or already derived: nothing.
 */
export function updateCell(w: Working, tableId: BlockId, row: Y.Map<unknown>, col: string): void {
  const ts = w.tables.get(tableId);
  const key: unknown = row.get(TRACK_KEY);
  if (ts === undefined || typeof key !== "string") return;
  const id = cellId(tableId, key, col);
  const rec = w.get(ts.tree, id);
  if (rec === undefined || w.fresh.has(id) || rec.parentId !== typeId(row)) return;
  putCell(w, id, ts.tree, cellFlowOf(row, col), cellAttrs(row, col, spanOf(rec.attrs["rowSpan"]), spanOf(rec.attrs["colSpan"])), linksOf(rec));
}

/** The table's record: `a:*` + `columnWidths` (R10) + `headerRowCount` (R6h, when > 0). */
export function tableRecord(ts: TableState, links: Links): Block {
  const attrs = scalarsWithPrefix(ts.map, "a:");
  delete attrs["columnWidths"];
  delete attrs["headerRowCount"];
  if (ts.widths !== null) attrs["columnWidths"] = ts.widths;
  if (ts.headerCount > 0) attrs["headerRowCount"] = ts.headerCount;
  const rendered = ts.rowCells.length > 0;
  return containerRecord(
    ts.id,
    BLOCK_TYPES.table,
    Object.freeze(attrs),
    links,
    rendered ? (ts.rows[0]?.id ?? null) : null,
    rendered ? (ts.rows[ts.rowCells.length - 1]?.id ?? null) : null,
  );
}

/** Remove a table's row and cell records and cell flows (its own record is its flow's). */
export function removeTable(w: Working, id: BlockId): void {
  const ts = w.tables.get(id);
  if (ts === undefined) return;
  ts.rowCells.forEach((cells, r) => {
    for (const cell of cells) removeFlow(w, cell.id);
    const row = ts.rows[r];
    if (row !== undefined) w.del(ts.tree, row.id);
  });
  w.tables = w.tables.delete(id);
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
      removeTable(w, id);
      w.del(fs.tree, id);
      id = b.nextSiblingId;
    }
    w.del(fs.tree, c);
  }
  if (fs.isRoot) w.del(fs.tree, fs.holderId);
  w.flows = w.flows.delete(holderId);
}

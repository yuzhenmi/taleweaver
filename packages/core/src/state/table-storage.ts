/**
 * Table grid storage writes (schema 3). A table is a mark + registry entry
 * `{ columns: Y.Array<ColId>, rows: Y.Array<RowId>, columnWidths: Y.Map<ColId, w> }`;
 * a row `{ table, cells: Y.Array<CellId> }` (append-only); a cell
 * `{ row, col, colSpanTo?, rowSpanTo?, flow }`. Spans are id RANGES, so a row /
 * column inserted inside a span is covered by it automatically; deleting the row /
 * column a span ends at retargets the span, and an anchor in a deleted row /
 * column is re-homed to the next row / column of its span. Nothing moves content:
 * covered cells keep their flows (read concatenated into the anchor).
 * The id arrays are plain `Y.Array<string>`s (not flows), so the index API is fine.
 */
import * as Y from "yjs";
import { getRegistry, buildEntry, entryFlow, entryIdArray, entryString, entryShape, type TreeKind } from "./registry";
import { firstPiece, FlowWriter, writeNodes, deleteContainerEntry, removeFromIdArray } from "./flow-ops";
import { clearDerivedCaches } from "./mark-index";
import { readCtx, gridOf } from "./flow-read";
import type { ReadonlyAttrs } from "./attrs";
import { productionAllocator } from "./block-id";

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  const e = getRegistry(doc).get(id);
  if (e === undefined) throw new Error(`table: "${id}" not found`);
  return e;
}

function treeOf(doc: Y.Doc, id: string): TreeKind {
  const t = getRegistry(doc).get(id)?.get("tree");
  return t === "embedContent" || t === "templateContent" ? t : "block";
}

function idArray(e: Y.Map<unknown>, key: string): Y.Array<string> {
  const a = entryIdArray(e, key);
  if (a === null) throw new Error(`table: entry has no "${key}"`);
  return a;
}

/** Insert a row entry after `prevRowId` (null = first) in the table's row order. */
export function insertRowEntry(doc: Y.Doc, tableId: string, rowId: string, prevRowId: string | null, attrs: ReadonlyAttrs = {}): void {
  const t = entry(doc, tableId);
  const rows = idArray(t, "rows");
  const re = buildEntry({ type: "table-row", attrs, tree: treeOf(doc, tableId), shape: "row" });
  re.set("table", tableId);
  getRegistry(doc).set(rowId, re);
  const at = prevRowId === null ? 0 : rows.toArray().indexOf(prevRowId) + 1;
  rows.insert(Math.max(0, at), [rowId]);
  clearDerivedCaches(doc);
}

/** Insert a column id after `prevColId` (null = first). */
export function insertColumnEntry(doc: Y.Doc, tableId: string, colId: string, prevColId: string | null): void {
  const cols = idArray(entry(doc, tableId), "columns");
  const at = prevColId === null ? 0 : cols.toArray().indexOf(prevColId) + 1;
  cols.insert(Math.max(0, at), [colId]);
  clearDerivedCaches(doc);
}

/** Create a cell entry at (row, col) holding one empty paragraph. */
export function createCell(doc: Y.Doc, rowId: string, colId: string, cellId: string, paragraphId: string, attrs: ReadonlyAttrs = {}): void {
  const reg = getRegistry(doc);
  const re = entry(doc, rowId);
  const tree = treeOf(doc, rowId);
  const ce = buildEntry({ type: "table-cell", attrs, tree, shape: "cell" });
  ce.set("row", rowId);
  ce.set("col", colId);
  reg.set(cellId, ce);
  const live = reg.get(cellId);
  const flow = live === undefined ? null : entryFlow(live);
  if (flow !== null) {
    writeNodes(doc, new FlowWriter(doc, { piece: firstPiece(flow), index: 0 }), [
      { id: paragraphId as never, type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] },
    ], tree);
  }
  idArray(re, "cells").push([cellId]);
  clearDerivedCaches(doc);
}

/** Live column ids of a table (read model order). */
export function liveColumns(doc: Y.Doc, tableId: string): readonly string[] {
  return gridOf(readCtx(doc), tableId)?.cols ?? [];
}

/** Live row ids of a table. */
export function liveRowIds(doc: Y.Doc, tableId: string): readonly string[] {
  return gridOf(readCtx(doc), tableId)?.rows ?? [];
}

/** The (row, col) slots of `rowId` that read as implicit (no real, uncovered cell). */
export function implicitSlots(doc: Y.Doc, tableId: string, rowId: string): string[] {
  const g = gridOf(readCtx(doc), tableId);
  return (g?.byRow.get(rowId) ?? []).filter((c) => c.id === `${rowId}|${c.col}`).map((c) => c.col);
}

/** Cells of the table (all rows), as entries. */
function allCells(doc: Y.Doc, tableId: string): [string, Y.Map<unknown>][] {
  const reg = getRegistry(doc);
  const out: [string, Y.Map<unknown>][] = [];
  for (const r of idArray(entry(doc, tableId), "rows").toArray()) {
    const re = reg.get(r);
    for (const c of re === undefined ? [] : idArray(re, "cells").toArray()) {
      const ce = reg.get(c);
      if (ce !== undefined && entryShape(ce) === "cell") out.push([c, ce]);
    }
  }
  return out;
}

/**
 * Delete a row: anchors in it whose span continues are re-homed to the next row;
 * spans ending at it end at the previous row. The row entry + remaining cells are
 * deleted (delete wins over concurrent edits inside).
 */
export function deleteRowEntry(doc: Y.Doc, tableId: string, rowId: string): void {
  const reg = getRegistry(doc);
  const t = entry(doc, tableId);
  const rows = idArray(t, "rows").toArray();
  const i = rows.indexOf(rowId);
  const prev = rows[i - 1];
  const next = rows[i + 1];
  for (const [cid, ce] of allCells(doc, tableId)) {
    const anchorRow = entryString(ce, "row");
    const to = entryString(ce, "rowSpanTo");
    if (anchorRow === rowId && to !== undefined && to !== rowId && next !== undefined) {
      // Re-home: the anchor moves to the next row of its span (content kept).
      const re = reg.get(rowId);
      if (re !== undefined) removeFromIdArray(idArray(re, "cells"), cid);
      ce.set("row", next);
      const ne = reg.get(next);
      if (ne !== undefined) idArray(ne, "cells").push([cid]);
      if (to === next) ce.delete("rowSpanTo");
    } else if (to === rowId) {
      if (prev === undefined || prev === anchorRow) ce.delete("rowSpanTo");
      else ce.set("rowSpanTo", prev);
    }
  }
  const re = reg.get(rowId);
  for (const c of re === undefined ? [] : idArray(re, "cells").toArray()) deleteContainerEntry(doc, c);
  removeFromIdArray(idArray(t, "rows"), rowId);
  reg.delete(rowId);
  clearDerivedCaches(doc);
}

/** Delete a column (mirror of {@link deleteRowEntry}); its width goes too. */
export function deleteColumnEntry(doc: Y.Doc, tableId: string, colId: string): void {
  const t = entry(doc, tableId);
  const cols = idArray(t, "columns").toArray();
  const i = cols.indexOf(colId);
  const prev = cols[i - 1];
  const next = cols[i + 1];
  for (const [cid, ce] of allCells(doc, tableId)) {
    const anchorCol = entryString(ce, "col");
    const to = entryString(ce, "colSpanTo");
    if (anchorCol === colId) {
      if (to !== undefined && to !== colId && next !== undefined) {
        ce.set("col", next);
        if (to === next) ce.delete("colSpanTo");
      } else {
        const row = entryString(ce, "row");
        const re = row === undefined ? undefined : getRegistry(doc).get(row);
        if (re !== undefined) removeFromIdArray(idArray(re, "cells"), cid);
        deleteContainerEntry(doc, cid);
      }
    } else if (to === colId) {
      if (prev === undefined || prev === anchorCol) ce.delete("colSpanTo");
      else ce.set("colSpanTo", prev);
    }
  }
  removeFromIdArray(idArray(t, "columns"), colId);
  const wm = t.get("columnWidths");
  if (wm instanceof Y.Map) wm.delete(colId);
  clearDerivedCaches(doc);
}

/** Set (or clear, with null) a cell's span targets. */
export function setCellSpan(doc: Y.Doc, cellId: string, colSpanTo: string | null, rowSpanTo: string | null): void {
  const ce = entry(doc, cellId);
  if (colSpanTo === null) ce.delete("colSpanTo");
  else if (ce.get("colSpanTo") !== colSpanTo) ce.set("colSpanTo", colSpanTo);
  if (rowSpanTo === null) ce.delete("rowSpanTo");
  else if (ce.get("rowSpanTo") !== rowSpanTo) ce.set("rowSpanTo", rowSpanTo);
  clearDerivedCaches(doc);
}

/** Fresh column id for a table. */
export function freshColumnId(): string {
  return productionAllocator.allocate();
}

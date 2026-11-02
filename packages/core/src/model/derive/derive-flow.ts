import * as Y from "yjs";
import { BLOCK_TYPES, type Block, type BlockId, EMBED_TYPES, type ReadonlyAttrs } from "../block";
import type { FlowState, SectionInfo, TableState, TreeKind } from "../document/types";
import { finalSectionId, flowEndId, footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import { isText } from "../scan/kinds";
import type { FootnoteRef, ScanCtx, Segment } from "../scan/tokens";
import { flowOf, scalarsWithPrefix } from "../storage/map-reads";
import { type BlockEntity, type Entity, type SectionBreakEntity, type TableEntity, flatten, group, indexSegments, isBlockEntity, isParaEntity, isSectionBreakEntity } from "./entities";
import { EMPTY_ATTRS, type Links, containerRecord, entityRecord } from "./records";
import { writeSections } from "./sections";
import { readTable } from "./table/read-table";
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
    if (e.k !== "table") {
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
  for (const e of ents) if (e.k === "table") deriveTable(w, e, tree);
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
// Tables: rows, cells and cell flows (from scratch); the read is `table/read-table.ts`
// ---------------------------------------------------------------------------

/**
 * Read table `e` (in `tree`) and write its row and cell records and cell flows. The
 * table record itself is written with its flow siblings ({@link tableRecord}).
 */
export function deriveTable(w: Working, e: TableEntity, tree: TreeKind): void {
  const ts = readTable(e.id, e.map, tree);
  w.tables = w.tables.set(e.id, ts);
  if (ts.cells.length === 0) return;
  let i = 0;
  ts.rows.forEach((row, r) => {
    const start = i;
    while (ts.cells[i]?.row === r) i++;
    const cells = ts.cells.slice(start, i);
    cells.forEach((cell, j) => {
      const links: Links = { parentId: row.id, prevSiblingId: cells[j - 1]?.id ?? null, nextSiblingId: cells[j + 1]?.id ?? null };
      deriveFlow(w, cell.id, tree, cell.flow, false, { type: BLOCK_TYPES.tableCell, attrs: cell.attrs, links });
    });
    w.put(
      tree,
      containerRecord(
        row.id,
        BLOCK_TYPES.tableRow,
        Object.freeze(scalarsWithPrefix(row.map, "a:")),
        { parentId: e.id, prevSiblingId: ts.rows[r - 1]?.id ?? null, nextSiblingId: ts.rows[r + 1]?.id ?? null },
        cells[0]?.id ?? null,
        cells[cells.length - 1]?.id ?? null,
      ),
    );
  });
}

/** The table's record: `a:*` + `columnWidths` (R10) + `headerRowCount` (R6h, when > 0). */
export function tableRecord(ts: TableState, links: Links): Block {
  const attrs = scalarsWithPrefix(ts.map, "a:");
  delete attrs["columnWidths"];
  delete attrs["headerRowCount"];
  if (ts.widths !== null) attrs["columnWidths"] = ts.widths;
  if (ts.headerCount > 0) attrs["headerRowCount"] = ts.headerCount;
  const rendered = ts.cells.length > 0;
  return containerRecord(
    ts.id,
    BLOCK_TYPES.table,
    Object.freeze(attrs),
    links,
    rendered ? (ts.rows[0]?.id ?? null) : null,
    rendered ? (ts.rows[ts.rows.length - 1]?.id ?? null) : null,
  );
}

/** Remove a table's row and cell records and cell flows (its own record is its flow's). */
export function removeTable(w: Working, id: BlockId): void {
  const ts = w.tables.get(id);
  if (ts === undefined) return;
  for (const cell of ts.cells) removeFlow(w, cell.id);
  if (ts.cells.length > 0) for (const row of ts.rows) w.del(ts.tree, row.id);
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

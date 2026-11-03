/** N1: tables as continuous text — marks → RT1–RT4 + virtual end cells → schema-3-shaped Block records. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Block } from "./block";
import { deriveDocument } from "./derive/derive-document";
import { getBlock, getEmbedContent, getEmbedContentIds, getTemplateContent } from "./document/blocks";
import type { Document } from "./document/types";
import { afterObjectId, debrisBeforeId, emptyCellParagraphId, flowEndId, footnoteBodyId, sectionIdOf, templateBodyId, virtualCellId } from "./ids";
import { Model } from "./model";
import { paragraphLayout } from "./position/paragraph-layout";
import { positionAtPoint } from "./position/position-at-point";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { BODIES_KEY, COLS_KEY, COL_SPAN_KEY, KIND_KEY, ROW_SPAN_KEY, WIDTH_KEY } from "./storage/keys";
import { TABLE_COLUMN_CAP } from "./storage/limits";
import { childMap } from "./storage/map-reads";
import { mapOf, newBody, newFootnoteOf } from "./storage/new-items";
import { newTableStart } from "./storage/table-marks";
import { expectSameVersion } from "./test-helpers/expect-same-version";
import { childrenOf, fixture, idOf, textOf } from "./test-helpers/fixture";
import { type Unit, cellIds, insertUnits, mapsOf, shape, units } from "./test-helpers/table";

const derive = (doc: Y.Doc): Document => deriveDocument(doc, BUILTIN_OBJECT_KINDS);

/** A body holding `spec` before its final ¶ (or after it, `atEnd`); the version, the inserted maps and the root id. */
function body(spec: string | readonly Unit[], atEnd = false): { d: Document; m: Y.Map<unknown>[]; rootId: string } {
  const f = fixture();
  const us = typeof spec === "string" ? units(spec) : spec;
  insertUnits(f.piece, atEnd ? f.piece.length : 0, us);
  return { d: derive(f.doc), m: mapsOf(us), rootId: f.rootId };
}

const section = (d: Document, rootId: string): Block[] => childrenOf(d, "block", `${rootId}/final`);
const types = (bs: readonly Block[]): string[] => bs.map((b) => b.type);

describe("records (the schema-3 component contract)", () => {
  it("a table reads as table → table-row → table-cell → paragraphs, all in its flow; ids are the marks' ids", () => {
    const us = units("x¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ y¶");
    const [, table, r0, c0, , c1, , r1] = mapsOf(us);
    if (table === undefined || r0 === undefined || c0 === undefined || c1 === undefined || r1 === undefined) throw new Error("spec");
    table.set("a:style", "grid");
    table.set(COLS_KEY, (() => {
      const a = new Y.Array<Y.Map<unknown>>();
      a.insert(0, [mapOf({ [WIDTH_KEY]: 1 }), mapOf({ [WIDTH_KEY]: 3 })]);
      return a;
    })());
    r0.set("a:height", 20);
    c0.set("a:bg", "red");
    const { d, rootId } = body(us);
    const id = idOf(table);
    expect(types(section(d, rootId))).toEqual(["paragraph", "table", "paragraph", "paragraph"]);
    expect(getBlock(d, id)).toMatchObject({ type: "table", attrs: { style: "grid", columnWidths: [0.25, 0.75] }, parentId: `${rootId}/final`, inlineContent: null });
    expect(getBlock(d, id)?.attrs["headerRowCount"]).toBeUndefined();
    expect(childrenOf(d, "block", id).map((r) => r.id)).toEqual([idOf(r0), idOf(r1)]);
    expect(getBlock(d, idOf(r0))).toMatchObject({ type: "table-row", attrs: { height: 20 }, parentId: id, prevSiblingId: null, nextSiblingId: idOf(r1) });
    expect(getBlock(d, idOf(c0))).toMatchObject({ type: "table-cell", attrs: { bg: "red" }, parentId: idOf(r0), prevSiblingId: null, nextSiblingId: idOf(c1) });
    expect(shape(d, id)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    const [p] = childrenOf(d, "block", idOf(c0));
    expect(p).toMatchObject({ type: "paragraph", parentId: idOf(c0), prevSiblingId: null, nextSiblingId: null });
    expect([...d.flows.entries()].map(([k]) => k)).toEqual([rootId]);
  });

  it("computed attrs replace stored ones; spans appear only when > 1", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧");
    const [table, , c0, , c1] = mapsOf(us);
    table?.set("a:columnWidths", "bogus");
    table?.set("a:headerRowCount", 9);
    c1?.set("a:rowSpan", 7);
    const { d } = body(us);
    const id = idOf(table ?? new Y.Map());
    expect(getBlock(d, id)?.attrs).toEqual({});
    expect(getBlock(d, idOf(c0 ?? new Y.Map()))?.attrs).toEqual({ rowSpan: 2 });
    expect(getBlock(d, idOf(c1 ?? new Y.Map()))?.attrs).toEqual({});
  });
});

describe("RT2 spans and clipping", () => {
  it("places cells by §17.5 and clips a colSpan to the free run (earlier cells win)", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩c2 A¶ ⟨c⟩r2 B¶ ⟨r⟩ ⟨c⟩c3 C¶ ⟧");
    const [table, , a, , b, , , c] = mapsOf(us);
    const { d } = body(us);
    expect(shape(d, idOf(table ?? new Y.Map()))).toEqual([["A", "B"], ["C"]]);
    expect(getBlock(d, idOf(a ?? new Y.Map()))?.attrs).toEqual({ colSpan: 2 });
    expect(getBlock(d, idOf(b ?? new Y.Map()))?.attrs).toEqual({ rowSpan: 2 });
    expect(getBlock(d, idOf(c ?? new Y.Map()))?.attrs).toEqual({ colSpan: 2 });
  });

  it("an invalid span reads 1, an overlong rowSpan is clipped to the rows left, the width is capped", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟨c⟩r9 d¶ ⟨r⟩ ⟨c⟩ e¶ ⟧");
    const [table, , ca, , cb, , cc, , cd, , ce] = mapsOf(us);
    ca?.set(ROW_SPAN_KEY, 0);
    cb?.set(COL_SPAN_KEY, 2.5);
    cc?.set(COL_SPAN_KEY, "2");
    const { d } = body(us);
    const at = (m: Y.Map<unknown> | undefined): Block | null => getBlock(d, idOf(m ?? new Y.Map()));
    expect([ca, cb, cc].map((m) => at(m)?.attrs)).toEqual([{}, {}, {}]);
    expect(at(cd)?.attrs).toEqual({ rowSpan: 2 });
    expect(shape(d, idOf(table ?? new Y.Map()))[1]?.[0]).toBe("e");
    void ce;

    // The width cap (Word's 63 columns) bounds what a row reads, whatever the stored spans.
    const wide = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ over¶ ⟨r⟩ ⟨c⟩ b¶ ⟧");
    mapsOf(wide)[2]?.set(COL_SPAN_KEY, 5000);
    const w = body(wide);
    const wt = idOf(mapsOf(wide)[0] ?? new Y.Map());
    const rows = cellIds(w.d, wt);
    expect(getBlock(w.d, rows[0]?.[0] ?? "")?.attrs).toEqual({ colSpan: TABLE_COLUMN_CAP });
    expect(rows.map((r) => r.length)).toEqual([1, TABLE_COLUMN_CAP]);
    expect(shape(w.d, wt)[0]).toEqual(["a|over"]); // the cell past the cap joins the cell before it
  });
});

describe("virtual end cells, F1 rows", () => {
  it("a short row reads virtual cells to the table's width, anchored at its next mark; a long row widens the table", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧");
    const [table, , , , , , r1, , , r2, , , , , , , end] = mapsOf(us);
    const { d } = body(us);
    const id = idOf(table ?? new Y.Map());
    const ids = cellIds(d, id);
    const fill = (m: Y.Map<unknown> | undefined, col: number): string => virtualCellId(idOf(m ?? new Y.Map()), col);
    expect(ids[0]?.[2]).toBe(fill(r1, 2));
    expect(ids[1]?.slice(1)).toEqual([fill(r2, 1), fill(r2, 2)]);
    expect(shape(d, id)).toEqual([
      ["a", "b", ""],
      ["c", "", ""],
      ["d", "e", "f"],
    ]);
    const v = getBlock(d, fill(r1, 2));
    expect(v).toMatchObject({ type: "table-cell", attrs: {} });
    expect(childrenOf(d, "block", fill(r1, 2)).map((p) => p.id)).toEqual([emptyCellParagraphId(fill(r1, 2))]);
    void end;
  });

  it("F1: every row is a row — a fully covered one has no cell, a cell-less one with free slots reads virtual cells", () => {
    const covered = units("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨r⟩ ⟧");
    const c = body(covered);
    const ct = idOf(mapsOf(covered)[0] ?? new Y.Map());
    expect(shape(c.d, ct)).toEqual([["a"], []]);
    expect(getBlock(c.d, ct)?.attrs).toEqual({});

    const free = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟧");
    const f = body(free);
    const [ft, , , , , end] = mapsOf(free);
    expect(cellIds(f.d, idOf(ft ?? new Y.Map()))[1]).toEqual([virtualCellId(idOf(end ?? new Y.Map()), 0)]);
  });
});

describe("RT1 binding", () => {
  it("stray marks (no table open, a ⟨c⟩ before any row, a wrong or invalid depth) are inert: the content around them joins", () => {
    const { d, rootId } = body("a ⟨c⟩ b ⟧ c ⟨r⟩ d¶");
    const [p] = section(d, rootId);
    expect(section(d, rootId).map((b) => textOf(b))).toEqual(["abcd", ""]);
    // Positions read them as the records do: inert units of one paragraph.
    const fs = d.flows.get(rootId);
    if (p === undefined || fs === undefined) throw new Error("no paragraph");
    expect(paragraphLayout(d, p.id)?.length).toBe(4);
    const piece = fs.segments[0]?.piece ?? new Y.Text();
    expect([0, 1, 3, 5].map((i) => positionAtPoint(d, fs, piece, i, 1))).toEqual([0, 1, 2, 3].map((offset) => ({ blockId: p.id, offset })));

    const us = units("⟦ ⟨c⟩ x ⟨r⟩ ⟨c⟩ a ⟨r⟩@1 b ⟨c⟩@x c ⟦@2 d¶ ⟧");
    const t = body(us);
    expect(shape(t.d, idOf(mapsOf(us)[0] ?? new Y.Map()))).toEqual([["x|abcd"]]);
  });

  it("F3: restored marks of a deleted nested table (depth 1, no ⟦@1 open) do not split the outer table", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩@1 ⟨c⟩@1 x¶ ⟧@1 ⟨c⟩ b¶ ⟧");
    const { d } = body(us);
    expect(shape(d, idOf(mapsOf(us)[0] ?? new Y.Map()))).toEqual([["a|x", "b"]]);
  });

  it("nests by depth; a nested table's implicit paragraph is anchored at its ⟧ (at its ⟦ when unclosed)", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 in¶ ⟧@1 ⟨c⟩ b¶ ⟧");
    const [outer, , c0, inner, , ic, , innerEnd] = mapsOf(us);
    const { d } = body(us);
    const kids = childrenOf(d, "block", idOf(c0 ?? new Y.Map()));
    expect(kids.map((b) => b.id)).toEqual([idOf(inner ?? new Y.Map()), afterObjectId(idOf(innerEnd ?? new Y.Map()))]);
    expect(kids[0]?.parentId).toBe(idOf(c0 ?? new Y.Map()));
    expect(shape(d, idOf(inner ?? new Y.Map()))).toEqual([["in"]]);
    expect(getBlock(d, idOf(ic ?? new Y.Map()))?.parentId).toBe(idOf(mapsOf(us)[4] ?? new Y.Map()));
    expect(shape(d, idOf(outer ?? new Y.Map()))).toEqual([["T|", "b"]]);
  });

  it("a shallower mark closes deeper open tables first", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 in¶ ⟨c⟩ out¶ ⟧");
    const [outer, , c0, inner] = mapsOf(us);
    const { d } = body(us);
    expect(shape(d, idOf(outer ?? new Y.Map()))).toEqual([["T|", "out"]]);
    expect(childrenOf(d, "block", idOf(c0 ?? new Y.Map()))[1]?.id).toBe(afterObjectId(idOf(inner ?? new Y.Map())));
  });

  it("a ⟦ at the depth cap is inert, and so are its marks", () => {
    const nest = [0, 1, 2, 3, 4].map((n) => `⟦@${n} ⟨r⟩@${n} ⟨c⟩@${n}`).join(" ");
    const us = units(`${nest} deep¶ ⟧@3 ⟧@2 ⟧@1 ⟧`);
    const { d } = body(us);
    const t3 = mapsOf(us)[9];
    expect(shape(d, idOf(t3 ?? new Y.Map()))).toEqual([["deep"]]);
  });
});

describe("F2 leads, F6 debris, closers, empty cells", () => {
  it("leads join the cell at their row's slot 0: prepended to a cell starting there, appended to a covering head, or a virtual cell's content", () => {
    const us = units("⟦ L1¶ ⟨r⟩ L2¶ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ L3¶ ⟨c⟩ c¶ ⟨r⟩ L4¶ ⟧");
    const { d } = body(us);
    expect(shape(d, idOf(mapsOf(us)[0] ?? new Y.Map()))).toEqual([
      ["L1|L2|a|L3", "b"],
      ["c"],
      ["L4", ""],
    ]);
  });

  it("a table with no cell is a childless record; its leads read right after it", () => {
    const us = units("⟦ L¶ ⟨r⟩ ⟧ z¶");
    const { d, rootId } = body(us);
    const s = section(d, rootId);
    expect(types(s)).toEqual(["table", "paragraph", "paragraph", "paragraph"]);
    expect(s[0]?.firstChildId).toBeNull();
    expect(s.map((b) => textOf(b))).toEqual(["", "L", "z", ""]);
  });

  it("F6: content no ¶ ends is debris of the mark closing its container", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ a ⟨c⟩ b ⟧");
    const [table, , c0, c1, end] = mapsOf(us);
    const { d } = body(us);
    expect(childrenOf(d, "block", idOf(c0 ?? new Y.Map())).map((p) => p.id)).toEqual([debrisBeforeId(idOf(c1 ?? new Y.Map()))]);
    expect(childrenOf(d, "block", idOf(c1 ?? new Y.Map())).map((p) => p.id)).toEqual([debrisBeforeId(idOf(end ?? new Y.Map()))]);
    expect(shape(d, idOf(table ?? new Y.Map()))).toEqual([["a", "b"]]);
  });

  it("[S] and <end> close open tables; an unclosed last row's virtual cells anchor at its ⟦", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ a [S] b¶");
    const { d, rootId } = body(us);
    const [table, , c0, S] = mapsOf(us);
    const sec1 = childrenOf(d, "block", sectionIdOf(idOf(S ?? new Y.Map())));
    expect(sec1.map((b) => b.id)).toEqual([idOf(table ?? new Y.Map()), afterObjectId(idOf(table ?? new Y.Map()))]);
    expect(childrenOf(d, "block", idOf(c0 ?? new Y.Map())).map((p) => p.id)).toEqual([debrisBeforeId(idOf(S ?? new Y.Map()))]);
    expect(section(d, rootId).map((b) => textOf(b))).toEqual(["b", ""]);
    // The unclosed table's implicit paragraph is anchored where the table ends: at the [S], not inside it.
    const after = paragraphLayout(d, afterObjectId(idOf(table ?? new Y.Map())));
    expect([after?.end?.token.id, after?.length, after?.parts.length, after?.head?.index]).toEqual([idOf(S ?? new Y.Map()), 0, 0, us.indexOf(S ?? new Y.Map())]);

    const tail = units("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c");
    const e = body(tail, true);
    const [t2, , , , , , r1, c2] = mapsOf(tail);
    const id2 = idOf(t2 ?? new Y.Map());
    expect(cellIds(e.d, id2)[1]).toEqual([idOf(c2 ?? new Y.Map()), virtualCellId(id2, 1)]);
    expect(childrenOf(e.d, "block", idOf(c2 ?? new Y.Map())).map((p) => p.id)).toEqual([flowEndId(e.rootId)]);
    expect(section(e.d, e.rootId).map((b) => b.id).slice(-1)).toEqual([afterObjectId(id2)]);
    void r1;
  });

  it("a cell holding nothing reads one empty paragraph `${cell}/empty`", () => {
    const us = units("⟦ ⟨r⟩ ⟨c⟩ ⟨c⟩ b¶ ⟧");
    const [, , c0] = mapsOf(us);
    const { d } = body(us);
    const id = idOf(c0 ?? new Y.Map());
    expect(childrenOf(d, "block", id).map((p) => [p.id, p.type])).toEqual([[emptyCellParagraphId(id), "paragraph"]]);
  });
});

describe("RT3 widths, RT4 header band", () => {
  const withCols = (entries: readonly Y.Map<unknown>[], spec: string): { d: Document; id: string } => {
    const table = newTableStart(0);
    const cols = new Y.Array<Y.Map<unknown>>();
    cols.insert(0, entries.slice());
    table.set(COLS_KEY, cols);
    const us = [table, ...units(spec)];
    return { d: body(us).d, id: idOf(table) };
  };

  it("entry i is grid column i; a missing / invalid weight is the mean of the valid ones; extras are ignored; none valid → auto", () => {
    const three = withCols([mapOf({ [WIDTH_KEY]: 2 }), mapOf({ [WIDTH_KEY]: "x" })], "⟨r⟩ ⟨c⟩ ⟨c⟩ ⟨c⟩ ⟧");
    expect(getBlock(three.d, three.id)?.attrs["columnWidths"]).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const extra = withCols([mapOf({ [WIDTH_KEY]: 1 }), mapOf({ [WIDTH_KEY]: 3 }), mapOf({ [WIDTH_KEY]: 9 })], "⟨r⟩ ⟨c⟩ ⟨c⟩ ⟧");
    expect(getBlock(extra.d, extra.id)?.attrs["columnWidths"]).toEqual([0.25, 0.75]);
    const none = withCols([mapOf({ [WIDTH_KEY]: -1 }), mapOf({})], "⟨r⟩ ⟨c⟩ ⟨c⟩ ⟧");
    expect(getBlock(none.d, none.id)?.attrs["columnWidths"]).toBeUndefined();
  });

  it("counts the leading run of header rows, clamped so no span crosses its end", () => {
    const two = body(units("⟦ ⟨r⟩h ⟨c⟩ ⟨r⟩h ⟨c⟩ ⟨r⟩ ⟨c⟩ ⟨r⟩h ⟨c⟩ ⟧"));
    const t2 = two.m[0];
    expect(getBlock(two.d, idOf(t2 ?? new Y.Map()))?.attrs["headerRowCount"]).toBe(2);
    const crossed = body(units("⟦ ⟨r⟩h ⟨c⟩ ⟨r⟩h ⟨c⟩r2 ⟨r⟩ ⟧"));
    expect(getBlock(crossed.d, idOf(crossed.m[0] ?? new Y.Map()))?.attrs["headerRowCount"]).toBe(1);
  });
});

describe("the stored table form (N2: the row splice's state)", () => {
  it("per row: the carry from above (stored spans), the placements and the width; width counts, the raw header run, depth, closer", () => {
    const us = units("⟦ ⟨r⟩h ⟨c⟩r9 ⟨c⟩ ⟨r⟩h ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 ⟧@1 ⟨r⟩ ⟨c⟩ ⟨c⟩ ⟨c⟩ ⟧ ⟦ ⟨r⟩ ⟨c⟩");
    const { d, rootId } = body(us);
    const [t, r0, c00, , r1, c10, n, nr, , nEnd, r2, , , , end, u, ur] = mapsOf(us).map(idOf);
    const fs = d.flows.get(rootId);
    const f = fs?.tables.get(t ?? "");
    expect(f).toMatchObject({ depth: 0, closeId: end, rawHeaderRun: 2 });
    expect(f?.rows.map((r) => r.id)).toEqual([r0, r1, r2]);
    expect(f?.rows.map((r) => r.carryIn)).toEqual([[], [{ head: c00, rowsLeft: 8 }], [{ head: c00, rowsLeft: 7 }]]);
    expect(f?.rows[1]?.placed).toEqual([{ cellId: c10, gridCol: 1, rowSpan: 1, colSpan: 1 }]);
    expect(f?.rows.map((r) => r.width)).toEqual([2, 2, 4]);
    expect(f?.widthCount.slice(0, 5)).toEqual([0, 0, 2, 0, 1]);
    expect(f?.rowIndex.get(r2 ?? "")).toBe(2);
    expect(fs?.tables.get(n ?? "")).toMatchObject({ depth: 1, closeId: nEnd, rows: [{ id: nr }] });
    // Unclosed (closed by <end>): no closer.
    expect(fs?.tables.get(u ?? "")).toMatchObject({ closeId: null, rows: [{ id: ur }] });
    // RT4 from the carries: the head of row 0 crosses boundaries 2 and 1, so the band shrinks to nothing.
    expect(getBlock(d, t ?? "")?.attrs["headerRowCount"]).toBeUndefined();
  });
});

describe("tables in other flows", () => {
  it("a table in a footnote body / header body reads in that tree", () => {
    const f = fixture();
    const fnPiece = new Y.Text();
    const fnUs = units("⟦ ⟨r⟩ ⟨c⟩ in-footnote¶ ⟧ ¶");
    insertUnits(fnPiece, 0, fnUs);
    const anchor = newFootnoteOf(fnPiece);
    f.piece.insertEmbed(0, anchor);
    const b = newBody();
    childMap(f.docMap, BODIES_KEY)?.set("h1", b);
    const flow = b.get("flow");
    const hp: unknown = flow instanceof Y.Array ? flow.get(0) : null;
    const hUs = units("⟦ ⟨r⟩ ⟨c⟩ in-header¶ ⟧");
    if (hp instanceof Y.Text) insertUnits(hp, 0, hUs);
    const d = derive(f.doc);
    const fnTable = idOf(mapsOf(fnUs)[0] ?? new Y.Map());
    const hTable = idOf(mapsOf(hUs)[0] ?? new Y.Map());
    expect(getEmbedContentIds(d)).toEqual([footnoteBodyId(idOf(anchor))]);
    expect(getEmbedContent(d, fnTable)).toMatchObject({ type: "table", parentId: footnoteBodyId(idOf(anchor)) });
    expect(shape(d, fnTable, "embedContent")).toEqual([["in-footnote"]]);
    expect(getTemplateContent(d, hTable)?.parentId).toBe(templateBodyId("h1"));
    expect(shape(d, hTable, "templateContent")).toEqual([["in-header"]]);
    expect(getBlock(d, fnTable)).toBeNull();
  });

  it("a footnote anchored in a main-tree cell is read; in a cell of a table in a footnote body it is inert", () => {
    const f = fixture();
    const fnPiece = new Y.Text();
    const inner = newFootnoteOf(new Y.Text());
    insertUnits(fnPiece, 0, ["⟦ ⟨r⟩ ⟨c⟩", "y", inner, "¶ ⟧ ¶"].flatMap((u) => (typeof u === "string" && /[⟦⟨¶]/.test(u) ? units(u) : [u])));
    const inCell = newFootnoteOf(new Y.Text());
    const outer = newFootnoteOf(fnPiece);
    const us = [...units("⟦ ⟨r⟩ ⟨c⟩ x"), inCell, ...units("¶ ⟧"), outer];
    insertUnits(f.piece, 0, us);
    const d = derive(f.doc);
    expect(getEmbedContentIds(d)).toEqual([footnoteBodyId(idOf(inCell)), footnoteBodyId(idOf(outer))].sort());
    expect(shape(d, idOf(mapsOf(us)[0] ?? new Y.Map()))).toEqual([["x￼"]]);
  });
});

describe("the live model with tables (N1: table edits re-derive their flow)", () => {
  it("every edit around and inside a table reads as from scratch", () => {
    const f = fixture();
    const model = new Model(f.doc);
    const check = (): void => expectSameVersion(model.version, derive(f.doc));
    const us = units("before¶ ⟦ ⟨r⟩ ⟨c⟩ a1¶ a2¶ a3¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧");
    f.doc.transact(() => insertUnits(f.piece, 0, us));
    check();
    const [, table, , c0] = mapsOf(us);
    const at = (m: Y.Map<unknown> | undefined): number => {
      const it = m?._item;
      let n = 0;
      for (let x = f.piece._start; x !== null && x !== it; x = x.right) if (!x.deleted && x.countable) n += x.length;
      return n;
    };
    const step = (fn: () => void): void => {
      f.doc.transact(fn);
      check();
    };
    step(() => f.piece.insert(at(c0) + 4, "X")); // inside a2 (between two ¶s of one cell: incremental)
    step(() => f.piece.insert(at(c0) + 1, "Y")); // the cell's first paragraph
    step(() => f.piece.insert(2, "Z")); // the paragraph before the table
    step(() => f.piece.insert(f.piece.length - 1, "after")); // the paragraph after the table
    step(() => table?.set("a:style", "s"));
    step(() => c0?.set(COL_SPAN_KEY, 2));
    step(() => {
      const cols = table?.get(COLS_KEY);
      if (cols instanceof Y.Array) cols.insert(0, [mapOf({ [WIDTH_KEY]: 3 })]);
    });
    step(() => c0?.set(KIND_KEY, "para")); // a mark flips kind, and back
    step(() => c0?.set(KIND_KEY, "cell"));
    step(() => insertUnits(f.piece, at(c0) + 1, units("⟦@1 ⟨r⟩@1 ⟨c⟩@1 deep¶ ⟧@1"))); // a nested table
    step(() => f.piece.insert(at(c0) + 6, "!")); // inside it
    step(() => insertUnits(f.piece, at(c0) + 2, units("[S]"))); // an [S] in a cell closes the tables
    step(() => f.piece.delete(at(c0) + 2, 1));
    step(() => f.piece.insertEmbed(at(c0) + 1, newFootnoteOf(new Y.Text()))); // a footnote in a cell
    const end = mapsOf(us)[mapsOf(us).length - 1];
    step(() => f.piece.delete(at(end), 1)); // the ⟧: the table runs to <end>
    step(() => f.piece.delete(at(table), 1)); // the ⟦: every mark is a stray
    model.destroy();
  });
});

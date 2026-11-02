/** P2 M1: table storage → read rules R6–R8, R10, R6h → schema-3-shaped Block records. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Block } from "./block";
import { deriveDocument } from "./derive/derive-document";
import { getBlock, getEmbedContent, getEmbedContentIds, getTemplateContent, getTemplateContentIds } from "./document/blocks";
import type { Document, TreeKind } from "./document/types";
import { cellId, flowEndId, footnoteBodyId, templateBodyId } from "./ids";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { BODIES_KEY, COLS_KEY, ITEM_KINDS, KIND_KEY, ROWS_KEY, WEIGHT_KEY } from "./storage/keys";
import { childMap } from "./storage/map-reads";
import { mapOf, newBody, newFootnoteOf, newParagraphMark } from "./storage/new-items";
import { newColMap, newRowMap, newTable } from "./storage/new-table";
import { cellFlowKey } from "./storage/table-keys";
import { expectSameVersion } from "./test-helpers/expect-same-version";
import { childrenOf, fixture, idOf, textOf } from "./test-helpers/fixture";
import { cellPiece, testRow, textFlow } from "./test-helpers/table";

const derive = (doc: Y.Doc): Document => deriveDocument(doc, BUILTIN_OBJECT_KINDS);
const cols = (...keys: string[]): Y.Map<unknown>[] => keys.map((k) => newColMap(k));

/** A body holding `table` then the final ¶; returns the derived version and the table's id. */
function withTable(table: Y.Map<unknown>): { d: Document; id: string; rootId: string } {
  const f = fixture();
  f.piece.insertEmbed(0, table);
  return { d: derive(f.doc), id: idOf(table), rootId: f.rootId };
}

const kids = (d: Document, id: string, tree: TreeKind = "block"): Block[] => childrenOf(d, tree, id);
/** The grid as rows of `rowKey|colKey` of the rendered cells (ids minus the table prefix). */
const grid = (d: Document, id: string, tree: TreeKind = "block"): string[][] =>
  kids(d, id, tree).map((r) => kids(d, r.id, tree).map((c) => c.id.slice(id.length + 1)));
const cellText = (d: Document, id: string, tree: TreeKind = "block"): string[] => kids(d, id, tree).map((b) => textOf(b));

describe("table records (schema-3 component contract)", () => {
  it("a table reads as table → table-row → table-cell → the cell flow's blocks, in its flow's tree", () => {
    const rows = [testRow("r0", { a: "A0", b: "B0" }, { "a:height": 20, "c:a:a:bg": "red" }), testRow("r1", { a: "A1", b: "B1" })];
    const table = newTable(rows, [newColMap("a", 1), newColMap("b", 1)], { "a:style": "grid" });
    const { d, id, rootId } = withTable(table);
    const section = kids(d, `${rootId}/final`);
    expect(section.map((b) => b.type)).toEqual(["table", "paragraph"]);
    const t = getBlock(d, id);
    expect(t).toMatchObject({ type: "table", attrs: { style: "grid", columnWidths: [0.5, 0.5] }, parentId: `${rootId}/final`, prevSiblingId: null, inlineContent: null });
    expect(t?.attrs["headerRowCount"]).toBeUndefined();
    expect(t?.nextSiblingId).toBe(section[1]?.id);
    const [r0, r1] = kids(d, id);
    expect(r0).toMatchObject({ id: idOf(rows[0] ?? new Y.Map()), type: "table-row", attrs: { height: 20 }, parentId: id, prevSiblingId: null, nextSiblingId: r1?.id, inlineContent: null });
    expect(r1).toMatchObject({ type: "table-row", attrs: {}, prevSiblingId: r0?.id, nextSiblingId: null });
    expect(grid(d, id)).toEqual([
      ["r0|a", "r0|b"],
      ["r1|a", "r1|b"],
    ]);
    const a0 = getBlock(d, cellId(id, "r0", "a"));
    const b0 = getBlock(d, cellId(id, "r0", "b"));
    expect(a0).toMatchObject({ type: "table-cell", attrs: { bg: "red" }, parentId: r0?.id, prevSiblingId: null, nextSiblingId: b0?.id, inlineContent: null });
    expect(b0).toMatchObject({ attrs: {}, prevSiblingId: a0?.id, nextSiblingId: null });
    const [p] = kids(d, cellId(id, "r0", "a"));
    expect(p).toMatchObject({ type: "paragraph", parentId: cellId(id, "r0", "a"), prevSiblingId: null, nextSiblingId: null });
    expect(textOf(p)).toBe("A0");
    expect(d.flows.get(cellId(id, "r1", "b"))?.tree).toBe("block");
  });

  it("computed attrs replace stored ones; spans / header count appear only when > 1 / > 0 as integers", () => {
    const rows = [
      testRow("r0", { a: "x", b: "y" }, { header: true, "c:a:rowSpanTo": "r1", "c:b:a:rowSpan": 7, "c:b:a:colSpan": 1 }),
      testRow("r1", { a: "", b: "z" }),
    ];
    const { d, id } = withTable(newTable(rows, cols("a", "b"), { "a:columnWidths": "bogus", "a:headerRowCount": 9 }));
    const t = getBlock(d, id);
    // No weights: auto layout; the header band is clamped to 0 by the span crossing row 1.
    expect(t?.attrs).toEqual({});
    expect(getBlock(d, cellId(id, "r0", "a"))?.attrs).toEqual({ rowSpan: 2 });
    expect(getBlock(d, cellId(id, "r0", "b"))?.attrs).toEqual({});
  });
});

describe("R6 tracks and slots", () => {
  it("a later duplicate key, non-map items and keyless / non-string-keyed maps are ignored", () => {
    const rows = new Y.Array<unknown>();
    rows.insert(0, [
      testRow("r0", { a: "first", b: "b" }),
      "junk",
      mapOf({ [cellFlowKey("a")]: textFlow("keyless") }),
      mapOf({ key: 5, [cellFlowKey("a")]: textFlow("numeric") }),
      testRow("r0", { a: "dup", b: "dup" }),
      testRow("r1", { a: "second", b: "b" }),
    ]);
    const colArr = new Y.Array<unknown>();
    colArr.insert(0, [newColMap("a"), 7, new Y.Map<unknown>(), newColMap("a", 5), newColMap("b")]);
    const table = mapOf({ k: "table", [ROWS_KEY]: rows, [COLS_KEY]: colArr });
    const { d, id } = withTable(table);
    expect(grid(d, id)).toEqual([
      ["r0|a", "r0|b"],
      ["r1|a", "r1|b"],
    ]);
    expect(cellText(d, cellId(id, "r0", "a"))).toEqual(["first"]);
    expect(cellText(d, cellId(id, "r1", "a"))).toEqual(["second"]);
    // The duplicate column's weight is not read: no valid weight → auto layout.
    expect(getBlock(d, id)?.attrs["columnWidths"]).toBeUndefined();
    const dupRow = rows.get(4);
    expect(dupRow instanceof Y.Map ? getBlock(d, idOf(dupRow)) : "not a map").toBeNull();
  });

  it("X4: a slot with no flow reads as one empty default paragraph `${cell}/end`; orphan column keys are not read", () => {
    const r0 = testRow("r0", { a: null, b: "b", gone: "orphan" }, { "c:gone:a:bg": "x" });
    r0.set(cellFlowKey("b"), "not an array");
    const { d, id } = withTable(newTable([r0], cols("a", "b")));
    for (const col of ["a", "b"]) {
      const cell = cellId(id, "r0", col);
      expect(kids(d, cell).map((b) => b.id)).toEqual([flowEndId(cell)]);
      expect(getBlock(d, flowEndId(cell))).toMatchObject({ type: "paragraph", attrs: {}, inlineContent: { items: [] } });
    }
    expect(grid(d, id)).toEqual([["r0|a", "r0|b"]]);
    expect(d.flows.has(cellId(id, "r0", "gone"))).toBe(false);
  });

  it("a table with no rows or no columns is a childless table record (a no-rows table keeps its columnWidths)", () => {
    const noCols = withTable(newTable([testRow("r0", { a: "x" }, { header: true })], []));
    expect(getBlock(noCols.d, noCols.id)).toMatchObject({ type: "table", attrs: {}, firstChildId: null, lastChildId: null });
    expect(getBlock(noCols.d, cellId(noCols.id, "r0", "a"))).toBeNull();
    const noRows = withTable(newTable([], [newColMap("a", 1)]));
    expect(getBlock(noRows.d, noRows.id)).toMatchObject({ attrs: { columnWidths: [1] }, firstChildId: null, lastChildId: null });
    const bare = withTable(mapOf({ k: "table" }));
    expect(getBlock(bare.d, bare.id)).toMatchObject({ type: "table", firstChildId: null });
  });
});

describe("R7 spans / R8 covered slots", () => {
  it("admits row-major: a span anchored in a covered slot is not admitted; an overlapping rectangle reads 1×1", () => {
    // 3 rows × 3 cols. r0.a spans a..b (covers r0.b, whose own rowSpanTo is not admitted).
    // r0.c spans rows 0..1. r1.b spans b..c, overlapping r1.c (covered) → 1×1.
    const rows = [
      testRow("r0", { a: "A", b: "hidden", c: "C" }, { "c:a:colSpanTo": "b", "c:b:rowSpanTo": "r1", "c:c:rowSpanTo": "r1" }),
      testRow("r1", { a: "", b: "B1", c: "hidden too" }, { "c:b:colSpanTo": "c" }),
      testRow("r2", { a: "", b: "", c: "" }),
    ];
    const { d, id } = withTable(newTable(rows, cols("a", "b", "c")));
    expect(grid(d, id)).toEqual([
      ["r0|a", "r0|c"],
      ["r1|a", "r1|b"],
      ["r2|a", "r2|b", "r2|c"],
    ]);
    expect(getBlock(d, cellId(id, "r0", "a"))?.attrs).toEqual({ colSpan: 2 });
    expect(getBlock(d, cellId(id, "r0", "c"))?.attrs).toEqual({ rowSpan: 2 });
    expect(getBlock(d, cellId(id, "r1", "b"))?.attrs).toEqual({});
    // R8: covered slots have no record and no flow, whatever they hold.
    for (const { r, c } of [{ r: "r0", c: "b" }, { r: "r1", c: "c" }]) {
      expect(getBlock(d, cellId(id, r, c))).toBeNull();
      expect(d.flows.has(cellId(id, r, c))).toBe(false);
    }
  });

  it("an unresolvable end (unknown key, a track before the anchor, a non-string) spans 1", () => {
    const rows = [
      testRow("r0", { a: "", b: "" }, { "c:a:rowSpanTo": "nope", "c:b:colSpanTo": "a" }),
      testRow("r1", { a: "", b: "" }, { "c:a:rowSpanTo": "r0", "c:b:rowSpanTo": 2 }),
    ];
    const { d, id } = withTable(newTable(rows, cols("a", "b")));
    expect(grid(d, id)).toEqual([
      ["r0|a", "r0|b"],
      ["r1|a", "r1|b"],
    ]);
    for (const c of kids(d, idOf(rows[0] ?? new Y.Map())).concat(kids(d, idOf(rows[1] ?? new Y.Map())))) expect(c.attrs).toEqual({});
  });

  it("a row whose slots are all covered has no cells", () => {
    const rows = [testRow("r0", { a: "x" }, { "c:a:rowSpanTo": "r1" }), testRow("r1", { a: "" })];
    const { d, id } = withTable(newTable(rows, cols("a")));
    expect(grid(d, id)).toEqual([["r0|a"], []]);
    expect(getBlock(d, idOf(rows[1] ?? new Y.Map()))).toMatchObject({ firstChildId: null, lastChildId: null });
  });
});

describe("R10 widths", () => {
  const widths = (weights: unknown[]): unknown => {
    const colMaps = weights.map((w, i) => (w === undefined ? newColMap(`c${i}`) : mapOf({ key: `c${i}`, weight: w })));
    const { d, id } = withTable(newTable([testRow("r0", {})], colMaps));
    return getBlock(d, id)?.attrs["columnWidths"];
  };

  it("valid weights normalise to sum 1; a missing / invalid weight is the mean of the valid ones", () => {
    expect(widths([1, 1, 2])).toEqual([0.25, 0.25, 0.5]);
    expect(widths([1, 3, undefined])).toEqual([1 / 6, 3 / 6, 2 / 6]);
    expect(widths([2, 0, -1, "2", Infinity, Number.NaN])).toEqual([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]);
  });

  it("no valid weight: no columnWidths (auto layout)", () => {
    expect(widths([undefined, undefined])).toBeUndefined();
    expect(widths([0, "x"])).toBeUndefined();
  });
});

describe("R6h header band", () => {
  const headerCount = (rows: Y.Map<unknown>[]): unknown => {
    const { d, id } = withTable(newTable(rows, cols("a")));
    return getBlock(d, id)?.attrs["headerRowCount"];
  };

  it("counts the leading run of `header === true` rows", () => {
    expect(headerCount([testRow("r0", {}, { header: true }), testRow("r1", {}, { header: true }), testRow("r2", {})])).toBe(2);
    expect(headerCount([testRow("r0", {}, { header: true }), testRow("r1", {}), testRow("r2", {}, { header: true })])).toBe(1);
    expect(headerCount([testRow("r0", {}, { header: "yes" }), testRow("r1", {}, { header: true })])).toBeUndefined();
  });

  it("clamps to the largest count no admitted span crosses", () => {
    const h = { header: true };
    expect(headerCount([testRow("r0", {}, h), testRow("r1", {}, { ...h, "c:a:rowSpanTo": "r2" }), testRow("r2", {})])).toBe(1);
    expect(headerCount([testRow("r0", {}, { ...h, "c:a:rowSpanTo": "r1" }), testRow("r1", {}, h), testRow("r2", {})])).toBe(2);
    expect(headerCount([testRow("r0", {}, { ...h, "c:a:rowSpanTo": "r2" }), testRow("r1", {}, h), testRow("r2", {})])).toBeUndefined();
  });
});

describe("tables in other flows", () => {
  it("nests: a table in a cell is a block of that cell, with its own cells", () => {
    const innerRow = testRow("i0", { x: "inner" });
    const inner = newTable([innerRow], cols("x"));
    const cellPieceText = new Y.Text();
    cellPieceText.insertEmbed(0, inner);
    cellPieceText.insertEmbed(1, newParagraphMark());
    const cellFlow = new Y.Array<Y.Text>();
    cellFlow.insert(0, [cellPieceText]);
    const { d, id } = withTable(newTable([testRow("r0", { a: cellFlow })], cols("a")));
    const outerCell = cellId(id, "r0", "a");
    const [t, after] = kids(d, outerCell);
    expect(t).toMatchObject({ id: idOf(inner), type: "table", parentId: outerCell, nextSiblingId: after?.id });
    expect(cellText(d, cellId(idOf(inner), "i0", "x"))).toEqual(["inner"]);
    expect(getBlock(d, cellId(idOf(inner), "i0", "x"))?.parentId).toBe(idOf(innerRow));
  });

  it("a table in a footnote body / header body reads in that tree; only the bodies are content roots", () => {
    const f = fixture();
    const fnTable = newTable([testRow("r0", { a: "in footnote" })], cols("a"));
    const fnPiece = new Y.Text();
    fnPiece.insertEmbed(0, fnTable);
    fnPiece.insertEmbed(1, newParagraphMark());
    const anchor = newFootnoteOf(fnPiece);
    f.piece.insertEmbed(0, anchor);
    const hTable = newTable([testRow("r0", { a: "in header" })], cols("a"));
    const body = newBody();
    childMap(f.docMap, BODIES_KEY)?.set("h1", body);
    const bodyPiece = body.get("flow");
    const hp: unknown = bodyPiece instanceof Y.Array ? bodyPiece.get(0) : null;
    if (hp instanceof Y.Text) hp.insertEmbed(0, hTable);
    const d = derive(f.doc);
    const fnId = footnoteBodyId(idOf(anchor));
    expect(getEmbedContentIds(d)).toEqual([fnId]);
    expect(getTemplateContentIds(d)).toEqual([templateBodyId("h1")]);
    expect(getEmbedContent(d, idOf(fnTable))).toMatchObject({ type: "table", parentId: fnId });
    expect(cellText(d, cellId(idOf(fnTable), "r0", "a"), "embedContent")).toEqual(["in footnote"]);
    expect(getTemplateContent(d, idOf(hTable))?.parentId).toBe(templateBodyId("h1"));
    expect(cellText(d, cellId(idOf(hTable), "r0", "a"), "templateContent")).toEqual(["in header"]);
    expect(getBlock(d, idOf(fnTable))).toBeNull();
  });

  it("a footnote anchored in a main-tree cell is read; in a cell of a table in a footnote body it is inert", () => {
    const f = fixture();
    const row = testRow("r0", { a: "x" });
    const table = newTable([row], cols("a"));
    f.piece.insertEmbed(0, table);
    const inCell = newFootnoteOf(new Y.Text());
    cellPiece(row, "a").insertEmbed(1, inCell);
    // A footnote after the table whose body holds a table, its cell anchoring another footnote.
    const fnRow = testRow("q0", { a: "y" });
    const fnTable = newTable([fnRow], cols("a"));
    const fnPiece = new Y.Text();
    fnPiece.insertEmbed(0, fnTable);
    fnPiece.insertEmbed(1, newParagraphMark());
    const outer = newFootnoteOf(fnPiece);
    f.piece.insertEmbed(1, outer);
    cellPiece(fnRow, "a").insertEmbed(1, newFootnoteOf(new Y.Text()));
    const d = derive(f.doc);
    expect(getEmbedContentIds(d)).toEqual([footnoteBodyId(idOf(inCell)), footnoteBodyId(idOf(outer))].sort());
    expect(textOf(kids(d, cellId(idOf(table), "r0", "a"))[0])).toBe("x\ufffc");
    expect(textOf(kids(d, cellId(idOf(fnTable), "q0", "a"), "embedContent")[0])).toBe("y");
  });
});

describe("cell ids", () => {
  it("escape `%`, `/` and `|` in the track keys", () => {
    expect(cellId("1:2", "a/b|c%", "x|y")).toBe("1:2/a%2Fb%7Cc%25|x%7Cy");
    expect(cellId("1:2", "a", "b|c")).not.toBe(cellId("1:2", "a|b", "c"));
    const { d, id } = withTable(newTable([testRow("a/b|c%", { "x|y": "t" })], cols("x|y")));
    expect(cellText(d, `${id}/a%2Fb%7Cc%25|x%7Cy`)).toEqual(["t"]);
  });
});

describe("the live model with tables", () => {
  it("every edit around and inside a table reads as from scratch", () => {
    const f = fixture();
    const model = new Model(f.doc);
    const check = (): void => expectSameVersion(model.version, derive(f.doc));
    const row = newRowMap("r0", ["a", "b"]);
    const table = newTable([row, newRowMap("r1", ["a", "b"])], [newColMap("a", 1), newColMap("b", 1)]);
    f.doc.transact(() => {
      f.piece.insert(0, "before");
      f.piece.insertEmbed(6, newParagraphMark());
      f.piece.insertEmbed(7, table);
    });
    check();
    cellPiece(row, "a").insert(0, "typed");
    check();
    f.piece.insert(3, "X"); // the paragraph before the table
    check();
    f.piece.insert(9, "after"); // typing right after the table
    check();
    table.set("a:style", "s");
    check();
    const colMaps = table.get(COLS_KEY);
    const col0: unknown = colMaps instanceof Y.Array ? colMaps.get(0) : null;
    if (col0 instanceof Y.Map) col0.set(WEIGHT_KEY, 3);
    check();
    table.set(KIND_KEY, "para"); // the table item flips kind, and back
    check();
    table.set(KIND_KEY, ITEM_KINDS.table);
    check();
    // A nested table, then a cell edit inside it.
    const innerRow = newRowMap("i0", ["x"]);
    cellPiece(row, "b").insertEmbed(0, newTable([innerRow], cols("x")));
    check();
    cellPiece(innerRow, "x").insert(0, "deep");
    check();
    // A footnote anchored in a cell, then an edit of its body.
    const cellFn = new Y.Text();
    cellFn.insertEmbed(0, newParagraphMark());
    cellPiece(row, "a").insertEmbed(0, newFootnoteOf(cellFn));
    check();
    cellFn.insert(0, "note");
    check();
    // A table in a header body, then a cell edit.
    const hRow = newRowMap("h0", ["a"]);
    const body = newBody();
    childMap(f.docMap, BODIES_KEY)?.set("h1", body);
    const bodyFlow = body.get("flow");
    const hp: unknown = bodyFlow instanceof Y.Array ? bodyFlow.get(0) : null;
    if (hp instanceof Y.Text) hp.insertEmbed(0, newTable([hRow], cols("a")));
    check();
    cellPiece(hRow, "a").insert(0, "hdr");
    check();
    row.set("header", true);
    check();
    row.set("c:a:colSpanTo", "b");
    check();
    const rows = table.get(ROWS_KEY);
    if (rows instanceof Y.Array) rows.delete(1, 1);
    check();
    // A footnote body holding a table, removed with its anchor.
    const fnPiece = new Y.Text();
    fnPiece.insertEmbed(0, newTable([newRowMap("q", ["a"])], cols("a")));
    fnPiece.insertEmbed(1, newParagraphMark());
    f.piece.insertEmbed(2, newFootnoteOf(fnPiece));
    check();
    f.piece.delete(2, 1);
    check();
    f.piece.delete(8, 1); // the table itself
    check();
    childMap(f.docMap, BODIES_KEY)?.delete("h1");
    check();
    expect([...model.version.tables.entries()]).toEqual([]);
    model.destroy();
  });
});

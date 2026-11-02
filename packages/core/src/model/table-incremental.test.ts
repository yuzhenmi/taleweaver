/**
 * P2 M2a — O4 for tables: every table edit derives incrementally (`full === false`)
 * and reads exactly as from scratch; edits in cells that are not rendered (covered,
 * duplicate row, orphan column) change nothing.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument } from "./derive/derive-document";
import type { Document } from "./document/types";
import { Model, type ModelChange } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { COLS_KEY, HEADER_KEY, ITEM_KINDS, KIND_KEY, ROWS_KEY, TRACK_KEY, WEIGHT_KEY } from "./storage/keys";
import { newFootnoteOf, newParagraphMark, newSubflow } from "./storage/new-items";
import { newColMap, newRowMap, newTable } from "./storage/new-table";
import { cellFlowKey, colSpanKey, rowSpanKey } from "./storage/table-keys";
import { expectSameVersion } from "./test-helpers/expect-same-version";
import { fixture } from "./test-helpers/fixture";
import { pick, rng } from "./oracle/random";
import { cellPiece, testRow, textFlow } from "./test-helpers/table";

const derive = (doc: Y.Doc): Document => deriveDocument(doc, BUILTIN_OBJECT_KINDS);

function tracks(table: Y.Map<unknown>, key: string): Y.Array<Y.Map<unknown>> {
  const a: unknown = table.get(key);
  if (!(a instanceof Y.Array)) throw new Error(`no ${key}`);
  return a;
}
function track(table: Y.Map<unknown>, key: string, i: number): Y.Map<unknown> {
  const m: unknown = tracks(table, key).get(i);
  if (!(m instanceof Y.Map)) throw new Error(`no ${key}[${i}]`);
  return m;
}

/** A body holding "before¶", an `n`-row table (rows r0…, columns `colKeys`), then the final ¶; every write is checked. */
function setup(n = 3, colKeys: readonly string[] = ["a", "b"]) {
  const f = fixture();
  const model = new Model(f.doc);
  const changes: ModelChange[] = [];
  model.subscribe((c) => changes.push(c));
  const rows: Y.Map<unknown>[] = [];
  for (let i = 0; i < n; i++) rows.push(newRowMap(`r${i}`, colKeys));
  const table = newTable(rows, colKeys.map((k) => newColMap(k, 1)));
  f.doc.transact(() => {
    f.piece.insert(0, "before");
    f.piece.insertEmbed(6, newParagraphMark());
    f.piece.insertEmbed(7, table);
  });
  /** `write` derives incrementally and reads as from scratch. */
  const step = (write: () => void): void => {
    changes.length = 0;
    f.doc.transact(write);
    expect(changes.map((c) => c.full), "one incremental change").toEqual([false]);
    expectSameVersion(model.version, derive(f.doc));
  };
  /** `write` (which may touch only storage that is not read) derives incrementally, if at all, and reads as from scratch. */
  const maybe = (write: () => void): void => {
    changes.length = 0;
    f.doc.transact(write);
    expect(changes.length, "at most one change").toBeLessThanOrEqual(1);
    expect(changes.some((c) => c.full), "incremental").toBe(false);
    expectSameVersion(model.version, derive(f.doc));
  };
  /** `write` (in a cell that is not rendered) changes nothing. */
  const hidden = (write: () => void): void => {
    const before = model.version;
    f.doc.transact(write);
    expect(model.version).toBe(before);
    expectSameVersion(model.version, derive(f.doc));
  };
  return { f, model, table, step, maybe, hidden, row: (i: number) => track(table, ROWS_KEY, i), col: (i: number) => track(table, COLS_KEY, i) };
}

describe("incremental tables (O4 per event class)", () => {
  it("cell content: text, pieces, ¶ attrs, a sub-flow", () => {
    const { row, step } = setup();
    step(() => cellPiece(row(1), "a").insert(0, "typed"));
    const flow = row(1).get(cellFlowKey("a"));
    if (!(flow instanceof Y.Array)) throw new Error("no flow");
    const more = new Y.Text();
    more.insert(0, "more");
    more.insertEmbed(4, newParagraphMark());
    step(() => flow.insert(1, [more]));
    step(() => flow.delete(1, 1));
    step(() => cellPiece(row(1), "a").insertEmbed(1, newParagraphMark()));
    const mark: unknown = cellPiece(row(1), "a").toDelta().find((op: { insert: unknown }) => op.insert instanceof Y.Map)?.insert;
    if (!(mark instanceof Y.Map)) throw new Error("no ¶");
    step(() => mark.set("p:align", "center"));
    const inner = new Y.Text();
    inner.insert(0, "sub");
    step(() => cellPiece(row(2), "b").insertEmbed(0, newSubflow(inner)));
    step(() => inner.insert(0, "x"));
  });

  it("cell keys: flow added (X4 → real) / replaced, cell attrs; spans, header, row attrs", () => {
    const { row, step } = setup();
    step(() => row(0).delete(cellFlowKey("b"))); // X4
    step(() => row(0).set(cellFlowKey("b"), textFlow("real")));
    step(() => row(0).set(cellFlowKey("b"), textFlow("again")));
    step(() => row(0).set("c:b:a:bg", "red"));
    step(() => row(0).set("c:a:a:q:rowSpanTo", "r1")); // column a's attr `q:rowSpanTo` (and the span key of no column)
    step(() => row(0).set(rowSpanKey("a"), "r1"));
    step(() => row(0).set(colSpanKey("a"), "b"));
    step(() => row(0).delete(rowSpanKey("a")));
    step(() => row(0).set(HEADER_KEY, true));
    step(() => row(1).set("a:height", 30));
    step(() => {
      row(2).set("c:a:a:bg", "blue");
      row(2).set(cellFlowKey("a"), textFlow("both"));
    });
  });

  it("rows and columns: insert / delete, a duplicate key revealed, weight, key change, table attrs and re-kind", () => {
    const { table, row, col, step } = setup();
    step(() => tracks(table, ROWS_KEY).insert(1, [newRowMap("n", ["a", "b"])]));
    step(() => tracks(table, ROWS_KEY).delete(1, 1));
    step(() => tracks(table, ROWS_KEY).insert(2, [testRow("r0", { a: "dup", b: "dup" })]));
    step(() => tracks(table, ROWS_KEY).delete(0, 1)); // the duplicate r0 is revealed
    step(() => tracks(table, COLS_KEY).insert(1, [newColMap("m", 2)]));
    step(() => tracks(table, COLS_KEY).delete(1, 1));
    step(() => col(0).set(WEIGHT_KEY, 3));
    step(() => col(1).set(TRACK_KEY, "z"));
    step(() => row(0).set(TRACK_KEY, "k"));
    step(() => table.set("a:style", "grid"));
    step(() => table.set(KIND_KEY, "para"));
    step(() => table.set(KIND_KEY, ITEM_KINDS.table));
    step(() => {
      table.set(KIND_KEY, "para"); // re-kinded together with a grid edit
      tracks(table, ROWS_KEY).insert(0, [newRowMap("z", ["a", "b"])]);
      row(1).set(HEADER_KEY, true);
    });
    step(() => table.set(KIND_KEY, ITEM_KINDS.table));
  });

  it("tables in regions, nested tables, a footnote in a cell", () => {
    const { f, row, step } = setup();
    step(() => f.piece.insert(3, "X")); // the paragraph before the table
    step(() => f.piece.insert(9, "after")); // right after the table
    const t2 = newTable([newRowMap("q", ["a"])], [newColMap("a")]);
    step(() => f.piece.insertEmbed(0, t2));
    step(() => f.piece.delete(0, 1));
    const innerRow = newRowMap("i0", ["x"]);
    step(() => cellPiece(row(0), "b").insertEmbed(0, newTable([innerRow], [newColMap("x")])));
    step(() => cellPiece(innerRow, "x").insert(0, "deep"));
    step(() => innerRow.set("c:x:a:bg", "red"));
    const fn = new Y.Text();
    fn.insertEmbed(0, newParagraphMark());
    step(() => cellPiece(row(1), "a").insertEmbed(0, newFootnoteOf(fn)));
    step(() => fn.insert(0, "note"));
    step(() => cellPiece(row(1), "a").delete(0, 1));
    step(() => f.piece.delete(7, 1)); // the table itself
  });

  it("edits in cells that are not rendered change nothing", () => {
    const { table, row, step, hidden } = setup();
    step(() => row(0).set(colSpanKey("a"), "b")); // r0|b is covered
    hidden(() => cellPiece(row(0), "b").insert(0, "covered"));
    hidden(() => row(0).set("c:b:a:bg", "red"));
    step(() => tracks(table, ROWS_KEY).insert(3, [testRow("r1", { a: "dup", b: "dup" })]));
    const dup = row(3);
    hidden(() => cellPiece(dup, "a").insert(0, "x"));
    hidden(() => dup.set(cellFlowKey("b"), textFlow("y")));
    hidden(() => dup.set("c:a:a:bg", "red"));
    hidden(() => dup.set(HEADER_KEY, true)); // a grid key of a row that is not rendered
    hidden(() => dup.set(rowSpanKey("a"), "r2"));
    hidden(() => row(1).set(rowSpanKey("q"), "r2")); // a span key of a column that does not exist
    hidden(() => row(1).set(cellFlowKey("q"), textFlow("orphan")));
    hidden(() => cellPiece(row(1), "q").insert(0, "x"));
    hidden(() => row(1).set("c:q:a:bg", "red"));
  });

  it("span-local regrid: rows / columns inside spans, overlap cascades, duplicates revealed and made", () => {
    const { table, row, step } = setup(8, ["a", "b", "c"]);
    step(() => row(1).set(rowSpanKey("a"), "r4"));
    step(() => tracks(table, ROWS_KEY).insert(3, [newRowMap("in", ["a", "b", "c"])])); // inside the span
    step(() => tracks(table, ROWS_KEY).delete(3, 1));
    step(() => tracks(table, ROWS_KEY).delete(4, 1)); // the span's end row: it spans 1
    step(() => row(6).set(colSpanKey("a"), "c"));
    step(() => tracks(table, COLS_KEY).insert(1, [newColMap("m", 1)])); // inside the column span
    step(() => tracks(table, COLS_KEY).delete(1, 1));
    // Overlap cascade: X (r0 b↓r2) rejects Y (r1 a→b); clearing X admits Y, which now rejects Z (r1 b↓r3).
    step(() => row(0).set(rowSpanKey("b"), "r2"));
    step(() => row(1).set(colSpanKey("a"), "b"));
    step(() => row(1).set(rowSpanKey("b"), "r3"));
    step(() => row(0).delete(rowSpanKey("b")));
    step(() => row(1).delete(colSpanKey("a")));
    // A far duplicate revealed by a delete, a key changed into and out of a duplicate.
    step(() => tracks(table, ROWS_KEY).push([testRow("r2", { a: "far", b: "far", c: "far" })]));
    step(() => tracks(table, ROWS_KEY).delete(2, 1));
    step(() => row(1).set(TRACK_KEY, "r5"));
    step(() => row(1).set(TRACK_KEY, "r1"));
    step(() => row(3).set(HEADER_KEY, true));
    step(() => row(0).set(HEADER_KEY, true));
  });

  it("randomized structural writes read as from scratch", () => {
    const keys = ["r0", "r1", "r2", "r3", "r4", "r5", "x"];
    const colKeys = ["a", "b", "c", "d", "y"];
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed);
      const { table, maybe: step } = setup(6, ["a", "b", "c", "d"]);
      const rows = tracks(table, ROWS_KEY);
      const cols = tracks(table, COLS_KEY);
      const at = (n: number): number => Math.floor(r() * n);
      const someRow = (): Y.Map<unknown> | undefined => (rows.length === 0 ? undefined : track(table, ROWS_KEY, at(rows.length)));
      const k = (xs: readonly string[]): string => pick(r, xs) ?? "";
      for (let i = 0; i < 60; i++) {
        const op = at(9);
        const m = someRow();
        if (op === 0) step(() => rows.insert(at(rows.length + 1), [newRowMap(k(keys), colKeys)]));
        else if (op === 1 && rows.length > 0) step(() => rows.delete(at(rows.length), 1));
        else if (op === 2) step(() => cols.insert(at(cols.length + 1), [newColMap(k(colKeys), 1 + at(3))]));
        else if (op === 3 && cols.length > 0) step(() => cols.delete(at(cols.length), 1));
        else if (op === 4 && m !== undefined) step(() => m.set(rowSpanKey(k(colKeys)), k(keys)));
        else if (op === 5 && m !== undefined) step(() => m.set(colSpanKey(k(colKeys)), k(colKeys)));
        else if (op === 6 && m !== undefined) {
          const key = r() < 0.5 ? rowSpanKey(k(colKeys)) : colSpanKey(k(colKeys));
          if (m.has(key)) step(() => m.delete(key));
        }
        else if (op === 7 && m !== undefined) step(() => m.set(HEADER_KEY, r() < 0.7));
        else if (op === 8 && m !== undefined) step(() => m.set(TRACK_KEY, k(keys)));
      }
    }
  });
});

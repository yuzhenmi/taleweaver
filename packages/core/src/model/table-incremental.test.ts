/** N2: structural incremental derive — edits around and inside tables read as from scratch, and splice locally. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { deriveDocument } from "./derive/derive-document";
import type { Document } from "./document/types";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { mapOf, newFootnoteOf, newParagraphMark } from "./storage/new-items";
import { expectSameVersion } from "./test-helpers/expect-same-version";
import { fixture, idOf } from "./test-helpers/fixture";
import { insertUnits, mapsOf, units } from "./test-helpers/table";
import { cellSplice } from "./update/cell-splice";
import { rowSplice } from "./update/row-splice";

// Spies on the rungs (calling through): which one applied a step.
vi.mock("./update/cell-splice", async (orig) => {
  const m = await orig<typeof import("./update/cell-splice")>();
  return { ...m, cellSplice: vi.fn(m.cellSplice) };
});
vi.mock("./update/row-splice", async (orig) => {
  const m = await orig<typeof import("./update/row-splice")>();
  return { ...m, rowSplice: vi.fn(m.rowSplice) };
});
beforeEach(() => vi.clearAllMocks());

/**
 * A live model over `spec` (inserted before the body's final ¶), led by a `far¶` paragraph.
 * `step(fn, local)` applies `fn` in one transaction and checks the version against a
 * from-scratch derive; `local` also checks the flow was spliced, not re-derived: the
 * far paragraph's record keeps its identity.
 */
function live(spec: string): {
  maps: Y.Map<unknown>[];
  piece: Y.Text;
  at: (m: Y.Map<unknown> | undefined) => number;
  step: (fn: () => void, local: boolean) => void;
  version: () => Document;
  destroy: () => void;
} {
  const f = fixture();
  const model = new Model(f.doc);
  const us = units(`far¶ ${spec}`);
  f.doc.transact(() => insertUnits(f.piece, 0, us));
  const maps = mapsOf(us);
  const far = idOf(maps[0] ?? new Y.Map());
  const at = (m: Y.Map<unknown> | undefined): number => {
    const item = m?._item;
    if (item === undefined || item === null) throw new Error("at: detached");
    let n = 0;
    for (let x = f.piece._start; x !== null && x !== item; x = x.right) if (!x.deleted && x.countable) n += x.length;
    return n;
  };
  const step = (fn: () => void, local: boolean): void => {
    const before = model.version.trees.block.get(far);
    f.doc.transact(fn);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    if (local) expect(model.version.trees.block.get(far)).toBe(before);
  };
  return { maps, piece: f.piece, at, step, version: () => model.version, destroy: () => model.destroy() };
}

describe("rung 0: content edits next to marks splice locally (faces)", () => {
  it("typing and Enter in a cell's first / middle / last paragraph, before and after a table, in a nested cell", () => {
    const t = live("before¶ ⟦ ⟨r⟩ ⟨c⟩ a1¶ a2¶ a3¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 deep¶ ⟧@1 tail¶ ⟨c⟩ d¶ ⟧ after¶");
    const [, , table, , c0, , , , c1, , , r1c0, , n, , nc, , nEnd, , c3, , end] = t.maps;
    t.step(() => t.piece.insert(t.at(c0) + 1, "Y"), true); // the cell's first paragraph (L = ⟨c⟩)
    t.step(() => t.piece.insert(t.at(c1) - 1, "Z"), true); // its last paragraph (R = ⟨c⟩)
    t.step(() => t.piece.insert(t.at(c0) + 6, "m"), true); // a middle one
    t.step(() => t.piece.insert(t.at(r1c0) + 1, "f"), true); // L = ⟨c⟩ right after ⟨r⟩
    t.step(() => t.piece.insert(t.at(end) - 1, "e"), true); // the last cell's last paragraph (R = ⟧)
    t.step(() => t.piece.insert(t.at(table) - 1, "B"), true); // the paragraph before the table (R = ⟦)
    t.step(() => t.piece.insert(t.at(end) + 1, "A"), true); // the paragraph after it (L = ⟧)
    t.step(() => t.piece.insert(t.at(nc) + 1, "N"), true); // a nested cell's first paragraph
    t.step(() => t.piece.insert(t.at(nEnd) + 1, "T"), true); // after a nested table, in its cell (L = ⟧@1)
    t.step(() => t.piece.insertEmbed(t.at(c0) + 2, newParagraphMark()), true); // Enter in a first paragraph
    t.step(() => t.piece.insert(t.at(c3), "debris"), true); // content after a cell's last ¶ (debris of the next ⟨c⟩)
    t.step(() => t.piece.delete(t.at(c3) - 6, 6), true);
    t.step(() => t.piece.insert(t.at(n), "x"), true); // R = a nested ⟦ in a cell
    expect(t.version().trees.block.get(idOf(n ?? new Y.Map()))?.type).toBe("table");
    t.destroy();
  });

  it("emptying a cell (`⟨c⟩⟨c⟩`, its `/empty` paragraph) and refilling it read as from scratch", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧");
    const [, , , c0, , c1] = t.maps;
    t.step(() => t.piece.delete(t.at(c0) + 1, 2), true); // rung 1: the row
    t.step(() => t.piece.insert(t.at(c1), "z"), true);
    t.destroy();
  });
});

describe("rung 0: whole tables in the region (insert / delete a table at any depth)", () => {
  it("inserting and deleting tables in the body and in a cell, with footnotes in their cells, splice locally", () => {
    const t = live("x¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ y¶");
    const [, x, , , c0, a] = t.maps;
    const table = units("⟦ ⟨r⟩ ⟨c⟩ p¶ ⟨c⟩ ¶ ⟨r⟩ ⟨c⟩ q¶ ⟧");
    t.step(() => insertUnits(t.piece, t.at(x) + 1, table), true); // a table between x¶ and the next table
    t.step(() => t.piece.insert(t.at(mapsOf(table)[3]), "P"), true); // typing in it
    t.step(() => t.piece.insertEmbed(t.at(mapsOf(table)[3]), newFootnoteOf(new Y.Text())), true); // a footnote in its cell
    const nested = units("⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟨r⟩@1 ⟨c⟩@1 ⟧@1");
    t.step(() => insertUnits(t.piece, t.at(c0) + 1, nested), true); // a nested table at a cell's start
    t.step(() => insertUnits(t.piece, t.at(a) + 1, units("⟦@1 ⟨r⟩@1 ⟨c⟩@1 m¶ ⟧@1")), true); // one at a cell's end
    t.step(() => t.piece.delete(t.at(nested[0] as Y.Map<unknown>), t.at(mapsOf(nested)[6]) + 1 - t.at(nested[0] as Y.Map<unknown>)), true); // delete a nested table
    const first = mapsOf(table);
    t.step(() => t.piece.delete(t.at(first[0]), t.at(first[first.length - 1]) + 1 - t.at(first[0])), true); // delete the inserted table (with its footnote)
    t.step(() => {
      // One transaction: an edit before a table and one inside it — the region straddles the table's ⟦ (widened by rung 1, N2 step 4).
      t.piece.insert(t.at(a) + 1, "!");
      t.piece.insert(t.at(x), "?");
    }, false);
    t.destroy();
  });
});

describe("rung 1: whole rows of a table", () => {
  it("row inserts / deletes, cell merges, span and header changes, leads: the row range re-forms locally", () => {
    const t = live("x¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧ y¶");
    const [, , , r0, , , c01, b, r1, c10, , c11, , r2, , , c21, , end] = t.maps;
    const row = units("⟨r⟩ ⟨c⟩ n¶ ⟨c⟩ o¶");
    t.step(() => insertUnits(t.piece, t.at(r1), row), true); // insert a row between rows 0 and 1
    t.step(() => t.piece.delete(t.at(mapsOf(row)[0]), 7), true); // and delete it again
    t.step(() => t.piece.delete(t.at(c11), 1), true); // merge row 1's cells: a virtual end cell pads it
    t.step(() => insertUnits(t.piece, t.at(r2), units("⟨c⟩")), true); // a cell back (empty)
    t.step(() => r0?.set("header", true), true); // a header row (RT4)
    t.step(() => c21?.set("rowSpan", 4), true); // a span in the last row: clipped to the end
    t.step(() => insertUnits(t.piece, t.at(end), units("⟨r⟩ ⟨c⟩ g¶")), true); // a row appended: the span reaches it
    t.step(() => t.piece.delete(t.at(end) - 4, 4), true); // and it goes again
    t.step(() => insertUnits(t.piece, t.at(c10), units("lead¶")), true); // a row lead (joins the row's first cell)
    t.step(() => t.piece.insert(t.at(c10) - 1, "L"), true); // typing in it
    t.step(() => t.piece.delete(t.at(b), 1), true); // a cell's only ¶: its content is debris of the next mark
    t.step(() => t.piece.insertEmbed(t.at(c01) + 1, newFootnoteOf(new Y.Text())), true); // a footnote, then its row deleted
    t.step(() => t.piece.delete(t.at(r0), t.at(r1) - t.at(r0)), true);
    t.destroy();
  });

  it("a nested table's row edit re-forms the nested table's rows only", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 p¶ ⟨r⟩@1 ⟨c⟩@1 q¶ ⟧@1 ⟨c⟩ b¶ ⟧");
    const nr1 = t.maps[8];
    t.step(() => t.piece.delete(t.at(nr1), 4), true);
    t.destroy();
  });
});

describe("rung 1, F4: the range runs on while its carry out differs from the next row's stored one", () => {
  it("a span set / grown / shrunk in an upper row, a row inserted inside a span (with and without its rowSpan + 1)", () => {
    // Rows 1–2 hold one cell each: a span over column 0 moves it right without widening the table.
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ g¶ ⟨c⟩ h¶ ⟧ y¶");
    const [, , , c00, , , , r1] = t.maps;
    t.step(() => c00?.set("rowSpan", 3), true); // rows 1–2 shift right; row 3 is where the carry meets the stored one
    t.step(() => c00?.set("rowSpan", 2), true);
    t.step(() => {
      // T1: a row inside the span, and the crossing head's rowSpan + 1, in one transaction.
      insertUnits(t.piece, t.at(r1), units("⟨r⟩ ⟨c⟩ n¶"));
      c00?.set("rowSpan", 3);
    }, true);
    t.step(() => insertUnits(t.piece, t.at(r1), units("⟨r⟩ ⟨c⟩ m¶")), true); // without the adjust: old row 1 leaves the span
    t.destroy();
  });
});

describe("rung 1: a changed column count (every other row's virtual end cells, RT3)", () => {
  it("a long row widens the table and its removal narrows it; a span pushing cells right widens it", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧ y¶");
    const [, table, , c00, , , b] = t.maps;
    const w = new Y.Array<Y.Map<unknown>>();
    w.insert(0, [mapOf({ w: 1 }), mapOf({ w: 3 })]); // a third column takes the mean weight (RT3)
    table?.set("cols", w);
    t.step(() => insertUnits(t.piece, t.at(b) + 1, units("⟨c⟩ x¶")), true); // row 0 gets a third cell
    t.step(() => t.piece.delete(t.at(b) + 1, 3), true); // and loses it
    t.step(() => c00?.set("rowSpan", 2), true); // row 1's cells move right: three columns
    t.step(() => c00?.set("rowSpan", 1), true);
    t.destroy();
  });
  it("a virtual cell at column 0 keeps the row lead it holds; a table losing its last cell re-derives", () => {
    let t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ lead¶ ⟧ y¶"); // row 1 has no cell: its lead is in its virtual cell at column 0
    t.step(() => insertUnits(t.piece, t.at(t.maps[6]) + 1, units("⟨c⟩ x¶")), true);
    t.destroy();
    t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ y¶");
    t.step(() => t.piece.delete(t.at(t.maps[3]), 1), false);
    t.destroy();
  });
});

describe("a `cols` edit re-reads its table's widths only (N4)", () => {
  it("inserting / deleting an entry and changing a weight, in a top-level and a nested table, splice without re-deriving", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟨c⟩@1 z¶ ⟧@1 ¶ ⟧ y¶");
    const [, table, , , , , inner] = t.maps;
    const colsOf = (m: Y.Map<unknown> | undefined): Y.Array<Y.Map<unknown>> => {
      const a = m?.get("cols");
      if (!(a instanceof Y.Array)) throw new Error("no cols");
      return a as Y.Array<Y.Map<unknown>>;
    };
    t.step(() => colsOf(table).insert(0, [mapOf({ w: 1 }), mapOf({ w: 3 })]), true);
    t.step(() => colsOf(table).get(1).set("w", 2), true);
    t.step(() => colsOf(table).delete(0, 1), true);
    t.step(() => colsOf(inner).insert(0, [mapOf({ w: 1 }), mapOf({})]), true);
    t.step(() => colsOf(inner).get(1).set("w", 5), true);
    t.step(() => colsOf(inner).delete(0, 2), true);
    t.destroy();
  });
});

describe("rung 1 edge cases (found by the O4 table fuzz)", () => {
  const at = (t: ReturnType<typeof live>, i: number): number => t.at(t.maps[i]);
  it("the table's lead joins row 0: the range starts at the ⟦ and spans old row 0", () => {
    let t = live("⟦ lead ⟨r⟩ ⟨c⟩ a¶ ⟧ y¶");
    t.step(() => t.piece.insertEmbed(at(t, 1) + 1, newParagraphMark()), true); // in the lead, R = row 0's ⟨r⟩
    t.destroy();
    t = live("⟦ lead¶ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ y¶");
    t.step(() => t.maps[5]?.set("a:bg", "x"), true); // a cell key in row 0: the lead stays in its first cell
    t.destroy();
    t = live("⟦ lead ⟨r⟩ ⟨c⟩ a¶ ⟧ y¶");
    t.step(() => insertUnits(t.piece, at(t, 2), units("⟨r⟩ ⟨c⟩ n¶")), true); // rows before old row 0: the lead moves to the new row 0
    t.destroy();
  });

  it("an edit that moves a table's end (its rows absorb the next table's) re-derives", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ ⟦ ⟨r⟩ ⟨c⟩ b¶ ⟧ y¶");
    t.step(() => t.piece.delete(at(t, 5), 1), false);
    t.destroy();
  });

  it("a row lead joining a head from above: the head's row holds it (re-derives)", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩r2 ⟨c⟩ t¶ ⟨r⟩ bc ⟨c⟩ u¶ ⟧ y¶");
    t.step(() => t.maps[4]?.set("a:bg", "x"), false);
    t.destroy();
  });

  it("a row holding a cell-less nested table with a lead: the lead leaves `leadsAfter` with the row", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ t ⟦@1 lead¶ ⟨c⟩ b¶ ⟧ y¶");
    t.step(() => t.piece.delete(at(t, 4), 1), true);
    t.destroy();
  });
});

describe("a cell-less table's leads (read after it, stored in its bracket)", () => {
  it("edits after its ⟧ or in its lead read as from scratch", () => {
    for (const spec of ["⟦ lead¶ ⟧ X [S] tail¶", "⟦ lead¶ ⟧ X ⟦ ⟨r⟩ ⟨c⟩ b¶ ⟧ tail¶", "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟦@1 lead¶ ⟧@1 X ⟨c⟩ b¶ ⟧"]) {
      const t = live(spec);
      const close = t.maps.find((m, i) => i > 0 && t.maps[i - 1]?.toJSON()["k"] === "para" && m.toJSON()["k"] === "tableEnd");
      t.step(() => t.piece.delete(t.at(close) + 1, 1), false); // the debris X after the ⟧
      t.destroy();
    }
    for (const marks of ["⟨r⟩ ⟨c⟩", "⟨r⟩"]) {
      const t = live("⟦ lead¶ more¶ ⟧ after¶");
      const lead = t.maps[2];
      t.step(() => insertUnits(t.piece, t.at(lead) + 1, units(marks)), false); // marks in the lead bind to the open table
      t.destroy();
    }
    for (const marks of ["⟨c⟩@1", "⟨r⟩@1"]) {
      // A table nested in a cell-less table's lead: its cells are at depth 2, though its record hangs outside the outer bracket.
      const t = live("⟦ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 a¶ b¶ ⟧@1 ⟧ after¶");
      const a = t.maps[5];
      t.step(() => insertUnits(t.piece, t.at(a) + 1, units(marks)), false);
      t.step(() => t.piece.insert(t.at(a), "x"), true);
      t.destroy();
    }
  });
});

describe("inert marks (RT1 strays) without the O(flow) fallback", () => {
  it("a flow holding strays still splices locally; edits in a run holding one, and new strays, too", () => {
    const t = live("p ⟨c⟩ q¶ mid¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ ⟨r⟩ z¶");
    const [, stray, , mid] = t.maps;
    t.step(() => t.piece.insert(t.at(mid) - 1, "x"), true); // elsewhere
    t.step(() => t.piece.insert(t.at(stray) + 1, "y"), true); // the run holding the stray
    t.step(() => insertUnits(t.piece, t.at(mid), units("⟧@2")), true); // a new stray
    t.step(() => t.piece.delete(t.at(stray), 1), true); // a stray deleted
    t.destroy();
  });

  it("edits that change what binds re-derive and read as from scratch", () => {
    const t = live("p¶ ⟨r⟩ ⟨c⟩ q¶ ⟧ s¶");
    const [p] = t.maps;
    t.step(() => insertUnits(t.piece, t.at(p) + 1, units("⟦")), false); // the strays now bind
    t.step(() => t.piece.delete(t.at(p) + 1, 1), false); // and are strays again
    t.destroy();
  });
});

describe("many change sites in one transaction: one region each (N4b step a)", () => {
  const table = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ x¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ f¶ ⟨c⟩ g¶ ⟨c⟩ h¶ ⟧ y¶";
  const rows = [2, 9, 16]; // the ⟨r⟩s; ⟧ is 23

  it("edits in distant paragraphs, twice in one paragraph, in cells of different rows and after the table", () => {
    const t = live(`p¶ q¶ r¶ s¶ ${table}`);
    const m = (i: number): Y.Map<unknown> | undefined => t.maps[i + 4];
    t.step(() => {
      t.piece.insert(t.at(t.maps[1]), "X"); // p¶ and s¶: two runs of one piece, apart
      t.piece.insert(t.at(t.maps[4]), "Y");
    }, true);
    t.step(() => {
      t.piece.insert(t.at(t.maps[2]) - 1, "1"); // two runs in q¶: one window
      t.piece.insert(t.at(t.maps[1]) + 1, "0");
    }, true);
    t.step(() => {
      t.piece.insert(t.at(m(4)), "A"); // a¶, d¶ (row 1), h¶ (row 2), y¶
      t.piece.insert(t.at(m(13)), "D");
      t.piece.insert(t.at(m(22)), "H");
      t.piece.insert(t.at(m(24)), "Y");
    }, true);
    t.destroy();
  });

  it("a cell inserted into every row (first, middle and last column) reads as from scratch", () => {
    for (const before of [(r: number) => r + 1, (r: number) => r + 3, (r: number) => r + 7]) {
      const t = live(table);
      const at = rows.map((r) => t.maps[before(r)]);
      t.step(() => {
        for (const mk of at) insertUnits(t.piece, t.at(mk), units("⟨c⟩ z¶"));
      }, true);
      expect(rowSplice).not.toHaveBeenCalled(); // rung 1c, one batch
      vi.clearAllMocks();
      t.destroy();
    }
  });

  it("a rung-1 edit with later edits in the same table: covered ones are skipped, reached ones join its range", () => {
    const t = live(table);
    const [, , , , , c01, , , x, , , , , , c12] = t.maps;
    t.step(() => {
      t.piece.delete(t.at(c01), 1); // row 0's cells merge (rung 1 over row 0) …
      t.piece.insert(t.at(x), "w"); // … which covers this edit in its last cell
      insertUnits(t.piece, t.at(c12), units("⟨r⟩ ⟨c⟩ n¶")); // a row split in row 1: its own rung-1 range
    }, true);
    t.destroy();
  });
});

describe("rung 1c: whole cells inserted / deleted, one batch per table (N4b step b)", () => {
  /** `step` local, applied by rung 1c alone (rung 1 never tried). */
  const cellStep = (t: ReturnType<typeof live>, fn: () => void): void => {
    vi.clearAllMocks();
    t.step(fn, true);
    expect(vi.mocked(cellSplice).mock.results.some((r) => r.value !== null)).toBe(true);
    expect(rowSplice).not.toHaveBeenCalled();
  };
  const cellAt = (t: ReturnType<typeof live>, m: Y.Map<unknown> | undefined, spec = "⟨c⟩ z¶"): Y.Map<unknown>[] => {
    const us = units(spec);
    insertUnits(t.piece, t.at(m), us);
    return mapsOf(us);
  };

  it("a rowSpan head moved by a cell before it: the row below re-places (F4), the column count and virtual end cells follow", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟧ y¶");
    const [, , , c00, , , , , c10, , , c20] = t.maps;
    let added: Y.Map<unknown>[] = [];
    cellStep(t, () => (added = cellAt(t, c00))); // row 0 only: row 1 is untouched but its carry moves to column 1
    cellStep(t, () => t.piece.delete(t.at(added[0]), 3)); // and back
    let col: Y.Map<unknown>[][] = [];
    cellStep(t, () => (col = [c20, c10, c00].map((m) => cellAt(t, m)))); // a column at grid column 0 (row 1's under the head)
    cellStep(t, () => col.forEach((ms) => t.piece.delete(t.at(ms[0]), 3))); // a column delete: one cell per row
    t.destroy();
  });

  it("short rows: a cell past the table's width adds virtual end cells to the others; a nested table in a new cell", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ y¶");
    const [, , , , , , , r1, , , end] = t.maps;
    cellStep(t, () => cellAt(t, r1)); // row 0 gets a third column: row 1 reads two virtual cells
    cellStep(t, () => cellAt(t, end, "⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟧@1 ¶")); // row 1's second (real) cell, holding a table
    t.destroy();
  });

  it("a cell holding a footnote deleted: its body goes", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ y¶");
    const [, , , , , c01, b] = t.maps;
    t.step(() => t.piece.insertEmbed(t.at(b), newFootnoteOf(new Y.Text())), true);
    expect(t.version().trees.embedContent.size).toBeGreaterThan(0);
    cellStep(t, () => t.piece.delete(t.at(c01), t.at(b) + 1 - t.at(c01)));
    expect(t.version().trees.embedContent.size).toBe(0);
    t.destroy();
  });

  it("a straddled colSpan head grown with the column's cells (rung 1 for the head's row, rung 1c for the rest)", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧ y¶");
    const [, , , head, , , , , c11, , , , c21] = t.maps;
    t.step(() => {
      head?.set("colSpan", 3);
      cellAt(t, c21);
      cellAt(t, c11);
    }, true);
    t.destroy();
  });

  it("a format in a cell's debris re-reads that cell (its unchanged `⟨c⟩` in the region)", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ t ⟨c⟩ b¶ ⟧ y¶");
    cellStep(t, () => t.piece.format(t.at(t.maps[5]), 2, { bold: true })); // the `⟨c⟩` and its debris
    t.destroy();
  });

  /** Rung 1c declined (every call null); `local`: the step was spliced, else re-derived. */
  const declined = (t: ReturnType<typeof live>, fn: () => void, local = true): void => {
    vi.clearAllMocks();
    t.step(fn, local);
    expect(vi.mocked(cellSplice).mock.results.length).toBeGreaterThan(0);
    expect(vi.mocked(cellSplice).mock.results.every((r) => r.value === null)).toBe(true);
  };

  it("declines when an untouched row reading outside its cells (past the column cap) has its carry-in changed (F4)", () => {
    const t = live(`⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ${"⟨c⟩ ".repeat(64)}⟧ y¶`);
    declined(t, () => cellAt(t, t.maps[3]), false);
    t.destroy();
  });

  it("declines a cell insert past the column cap", () => {
    const t = live(`⟦ ⟨r⟩ ${"⟨c⟩ ".repeat(63)}⟧ y¶`);
    declined(t, () => cellAt(t, t.maps[3]), false);
    t.destroy();
  });

  it("declines deleting the table's only cell (no columns left)", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ y¶");
    declined(t, () => t.piece.delete(t.at(t.maps[3]), 3), false);
    t.destroy();
  });

  it("a cell holding a nested table deleted: the nested table's form goes", () => {
    const t = live("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟧@1 ¶ ⟨c⟩ b¶ ⟧ y¶");
    const [, , , , , c01, , , , , , , c02] = t.maps;
    cellStep(t, () => t.piece.delete(t.at(c01), t.at(c02) - t.at(c01)));
    t.destroy();
  });

  it("a header row's rowSpan head deleted / restored: the header count crosses the boundary", () => {
    const t = live("⟦ ⟨r⟩h ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ y¶");
    const [, , , c00, , c01] = t.maps;
    cellStep(t, () => t.piece.delete(t.at(c00), t.at(c01) - t.at(c00))); // row 1 no longer covered: the header run is whole
    cellStep(t, () => cellAt(t, t.maps[3], "⟨c⟩r2 a¶")); // and covered again
    t.destroy();
  });

  it("declines to rung 1 in a row with a lead", () => {
    const t = live("⟦ ⟨r⟩ lead¶ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ y¶");
    t.step(() => cellAt(t, t.maps[6]), true);
    expect(rowSplice).toHaveBeenCalled();
    t.destroy();
  });
});

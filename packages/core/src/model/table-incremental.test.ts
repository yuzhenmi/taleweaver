/** N2: structural incremental derive — edits around and inside tables read as from scratch, and splice locally. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument } from "./derive/derive-document";
import type { Document } from "./document/types";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { newFootnoteOf, newParagraphMark } from "./storage/new-items";
import { expectSameVersion } from "./test-helpers/expect-same-version";
import { fixture, idOf } from "./test-helpers/fixture";
import { insertUnits, mapsOf, units } from "./test-helpers/table";

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

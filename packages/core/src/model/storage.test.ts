import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PMap } from "./pmap";
import { createEditorOrigin, flowContainerDeleteFilter } from "./storage/history-hooks";
import { PIECE_SOFT_MAX } from "./storage/limits";
import { newFootnote, newParagraphMark } from "./storage/new-items";
import { insertPieceAfter, pieceDepth, pieceIndex, pieceStructCount } from "./storage/pieces";
import { writablePoint } from "./storage/writable-point";
import { fixture } from "./test-helpers/fixture";

describe("pieces (X11) and sub-flows (X12)", () => {
  it("inserts a piece after another through the public Y.Array API", () => {
    const f = fixture();
    const b = new Y.Text();
    const c = new Y.Text();
    insertPieceAfter(f.piece, c);
    insertPieceAfter(f.piece, b);
    expect(f.flow.toArray()).toEqual([f.piece, b, c]);
    expect(pieceIndex(c)).toBe(2);
  });

  it("the piece-size rule writes into a fresh piece at the ends and a sub-flow mid-piece", () => {
    const f = fixture();
    for (let i = 0; i < PIECE_SOFT_MAX; i++) f.piece.insert(i, i % 2 === 0 ? "a" : "b", i % 2 === 0 ? { bold: true } : {});
    expect(pieceStructCount(f.piece)).toBeGreaterThanOrEqual(PIECE_SOFT_MAX);
    f.doc.transact(() => {
      const end = writablePoint({ piece: f.piece, index: f.piece.length });
      expect(end.piece).not.toBe(f.piece);
      expect(f.flow.get(1)).toBe(end.piece);
      const start = writablePoint({ piece: f.piece, index: 0 });
      expect(f.flow.get(0)).toBe(start.piece);
      const mid = writablePoint({ piece: f.piece, index: 5 });
      expect(pieceDepth(mid.piece)).toBe(1);
    });
    const small = writablePoint({ piece: new Y.Text(), index: 0 });
    expect(small.index).toBe(0);
  });
});

describe("history hooks", () => {
  it("X16: undo tracks only this editor's origin", () => {
    const f = fixture();
    const origin = createEditorOrigin();
    const um = new Y.UndoManager(f.docMap, { trackedOrigins: new Set([origin]), deleteFilter: flowContainerDeleteFilter });
    f.doc.transact(() => f.piece.insert(0, "mine"), origin);
    f.doc.transact(() => f.piece.insert(4, " theirs"), "remote");
    um.undo();
    expect(f.piece.toString().startsWith(" theirs")).toBe(true);
  });

  it("X17: undoing a piece creation keeps the piece when a peer typed in it", () => {
    const f = fixture();
    const origin = createEditorOrigin();
    const um = new Y.UndoManager(f.docMap, { trackedOrigins: new Set([origin]), deleteFilter: flowContainerDeleteFilter });
    const fresh = new Y.Text();
    f.doc.transact(() => insertPieceAfter(f.piece, fresh), origin);
    f.doc.transact(() => fresh.insert(0, "peer"), "remote");
    um.undo();
    expect(f.flow.length).toBe(2);
    expect(fresh.toString()).toBe("peer");
  });

  it("X17 lets undo delete content items, including a footnote with its nested body", () => {
    const f = fixture();
    const origin = createEditorOrigin();
    const um = new Y.UndoManager(f.docMap, { trackedOrigins: new Set([origin]), deleteFilter: flowContainerDeleteFilter });
    f.doc.transact(() => {
      f.piece.insertEmbed(0, newFootnote());
      f.piece.insertEmbed(1, newParagraphMark());
    }, origin);
    um.undo();
    expect(f.piece.length).toBe(1);
  });
});

describe("PMap", () => {
  it("is persistent: set / delete return new maps and keep the old ones", () => {
    let m = PMap.empty<number>();
    const versions: PMap<number>[] = [];
    for (let i = 0; i < 2000; i++) {
      m = m.set(`k${i}`, i);
      versions.push(m);
    }
    expect(m.size).toBe(2000);
    expect(versions[9]?.size).toBe(10);
    expect(versions[9]?.get("k10")).toBeUndefined();
    const d = m.delete("k5");
    expect(d.get("k5")).toBeUndefined();
    expect(m.get("k5")).toBe(5);
    expect(d.size).toBe(1999);
    expect(m.set("k5", 50).size).toBe(2000);
    expect([...d.entries()]).toHaveLength(1999);
    let e = d;
    for (let i = 0; i < 2000; i++) e = e.delete(`k${i}`);
    expect(e.size).toBe(0);
  });
});

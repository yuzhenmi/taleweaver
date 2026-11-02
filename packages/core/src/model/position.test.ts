import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Harness, typeLines } from "./test-helpers/harness";
import { deleteBackward } from "./commands/delete-backward";
import { deleteForward } from "./commands/delete-forward";
import { deleteSelection } from "./commands/delete-selection";
import { insertText } from "./commands/insert-text";
import { splitParagraph } from "./commands/split-paragraph";
import { insertObject } from "./commands/insert-object";
import { setObjectProps } from "./commands/set-object-props";
import { mapIndex, mapPosition } from "./mapping/map-position";
import { fromRelativePosition, toRelativePosition } from "./mapping/relative-position";
import { position } from "./position/model-position";
import { paragraphLayout } from "./position/paragraph-layout";
import { positionAtPoint } from "./position/position-at-point";
import { resolvePosition } from "./position/resolve-position";
import { pointAfter, pointBefore } from "./position/storage-points";
import { PIECE_SOFT_MAX } from "./storage/limits";
import { newObject, newParagraphMark, newTableOfContents } from "./storage/new-items";
import { pieceStructCount } from "./storage/pieces";
import { mapAt } from "./test-helpers/fixture";

function doc(text: string): Harness {
  const h = new Harness();
  typeLines(h, text, insertText, splitParagraph);
  return h;
}

/** A second peer synced with `h`; returns a function that pushes `h`'s updates to it and back. */
function peer(h: Harness): { doc: Y.Doc; sync: () => void } {
  const p = new Y.Doc();
  p.clientID = 99;
  const sync = (): void => {
    Y.applyUpdate(p, Y.encodeStateAsUpdate(h.f.doc, Y.encodeStateVector(p)));
    Y.applyUpdate(h.f.doc, Y.encodeStateAsUpdate(p, Y.encodeStateVector(h.f.doc)));
  };
  sync();
  return { doc: p, sync };
}

describe("resolution (R14 / R15 / R16)", () => {
  it("clamps, snaps into grapheme clusters, out of atomic mark runs, and before floats", () => {
    const h = doc("aéb👍🏽c");
    const d = h.version;
    const id = h.blockId(0);
    expect(resolvePosition(d, position(id, 99))).toEqual(position(id, 9));
    expect(resolvePosition(d, position(id, 2))).toEqual(position(id, 1)); // inside e + combining acute
    expect(resolvePosition(d, position(id, 6))).toEqual(position(id, 4)); // inside 👍🏽
    h.select([0, 1], [0, 4]);
    h.run(deleteSelection);
    h.caret(0, 1);
    h.run(insertText, "LINK", { link: "x" });
    const atomic = { isAtomicMark: (k: string) => k === "link" };
    expect(resolvePosition(h.version, position(id, 2), atomic)).toEqual(position(id, 1));
    expect(resolvePosition(h.version, position(id, 3), atomic)).toEqual(position(id, 5)); // tie → end
    expect(resolvePosition(h.version, position("nope", 0))).toBeNull();
    h.caret(0, 0);
    h.run(insertObject, "image", { props: { src: "a" } });
    h.run(setObjectProps, h.at(0, 0), { wrap: "left" });
    expect(resolvePosition(h.version, position(id, 1))).toEqual(position(id, 0));
  });

  it("R16: an offset at a piece boundary is the end of the earlier piece; inert storage reads as nothing", () => {
    const h = doc("ab");
    // An inert embed (unknown kind) between a and b, and a second piece holding "cd".
    h.f.doc.transact(() => {
      const unknown = new Y.Map<unknown>();
      unknown.set("k", "hologram");
      h.f.piece.insertEmbed(1, unknown);
    });
    const L = paragraphLayout(h.version, h.blockId(0));
    expect(L?.length).toBe(2);
    if (L === null) return;
    expect(pointAfter(L, 1)?.index).toBe(1); // before the inert unit
    expect(pointBefore(L, 1)?.index).toBe(2); // the unit of "b" (after the inert one)
    expect(positionAtPoint(h.version, L.fs, h.f.piece, 2, 1)).toEqual(position(h.blockId(0), 1));
    h.caret(0, 1);
    h.run(insertText, "X");
    expect(h.dump()).toEqual(["paragraph:aXb"]);
    // A range delete ending at an inert unit keeps it (edges are never deleted); one spanning it takes it.
    h.select([0, 1], [0, 2]);
    h.run(deleteSelection);
    expect(h.f.piece.length).toBe(4); // a, the inert unit, b, ¶
    h.select([0, 0], [0, 2]);
    h.run(deleteSelection);
    expect(h.f.piece.length).toBe(1);
  });
});

describe("exact mapping (D8)", () => {
  it("maps through a remote insert before / at the caret (assoc decides at the caret)", () => {
    const h = doc("abcd");
    const v0 = h.version;
    const id = h.blockId(0);
    const p = peer(h);
    const piece = p.doc.getMap("v4").get("doc");
    if (!(piece instanceof Y.Map)) throw new Error("no root");
    const flow = piece.get("flow");
    const pt = flow instanceof Y.Array ? flow.get(0) : null;
    if (!(pt instanceof Y.Text)) throw new Error("no piece");
    pt.insert(1, "XY");
    p.sync();
    expect(mapPosition(v0, h.version, position(id, 3))).toEqual({ position: position(id, 5), deleted: false });
    expect(mapPosition(v0, h.version, position(id, 1), -1).position).toEqual(position(id, 1));
    expect(mapPosition(v0, h.version, position(id, 1), 1).position).toEqual(position(id, 3));
  });

  it("follows Enter (head → the new ¶'s id, tail keeps the id) and Backspace joins; chains across versions", () => {
    const h = doc("abcd");
    const v0 = h.version;
    const id = h.blockId(0);
    h.caret(0, 2);
    h.run(splitParagraph);
    const head = h.blockId(0);
    expect(mapPosition(v0, h.version, position(id, 1)).position).toEqual(position(head, 1));
    expect(mapPosition(v0, h.version, position(id, 3)).position).toEqual(position(id, 1));
    const v1 = h.version;
    h.run(deleteBackward);
    expect(mapPosition(v1, h.version, position(head, 1)).position).toEqual(position(id, 1));
    expect(mapPosition(v0, h.version, position(id, 3)).position).toEqual(position(id, 3));
  });

  it("a position inside a deleted range maps to its start, flagged deleted; an unreached version is unmappable", () => {
    const h = doc("abc\ndef");
    const v0 = h.version;
    const second = h.blockId(1);
    h.select([0, 1], [1, 2]);
    h.run(deleteSelection);
    expect(mapPosition(v0, h.version, position(second, 1))).toEqual({ position: position(second, 1), deleted: true });
    expect(mapPosition(h.version, v0, position(second, 0)).position).toBeNull();
  });

  it("mapIndex: retain / insert / delete with assoc", () => {
    const delta = [{ retain: 2 }, { insert: "xx" }, { delete: 3 }];
    expect(mapIndex(delta, 1, 1)).toEqual({ index: 1, deleted: false });
    expect(mapIndex(delta, 2, -1)).toEqual({ index: 2, deleted: false });
    expect(mapIndex(delta, 2, 1)).toEqual({ index: 4, deleted: true });
    expect(mapIndex(delta, 3, 1)).toEqual({ index: 4, deleted: true });
    expect(mapIndex(delta, 6, 1)).toEqual({ index: 5, deleted: false });
    // Right before a deleted run: assoc −1 keeps its (live) left side; assoc 1 loses its right side.
    expect(mapIndex([{ retain: 2 }, { delete: 3 }], 2, -1)).toEqual({ index: 2, deleted: false });
    expect(mapIndex([{ retain: 2 }, { delete: 3 }], 2, 1)).toEqual({ index: 2, deleted: true });
    expect(mapIndex([{ retain: 2 }, { delete: 3 }], 5, -1)).toEqual({ index: 2, deleted: true });
  });

  it("RelativePositions survive later edits (incl. a remote one)", () => {
    const h = doc("abcd");
    const id = h.blockId(0);
    const rel = toRelativePosition(h.version, position(id, 2));
    if (rel === null) throw new Error("no rel");
    h.caret(0, 0);
    h.run(insertText, "zz");
    h.caret(0, 1);
    h.run(splitParagraph);
    expect(fromRelativePosition(h.version, rel)).toEqual(position(id, 3));
    // The embed's item id is stable too (a sanity check that ids are item ids).
    h.f.doc.transact(() => h.f.piece.insertEmbed(0, newObject("image", { props: { src: "a" } })));
    expect(typeof mapAt(h.f.piece, 0).get("kind")).toBe("string");
  });
});

describe("review fixes", () => {
  it("a point among 60 000 abutting TOCs resolves without recursion (positionAtPoint, mapPosition)", () => {
    const h = doc("a\nb");
    const v0 = h.version;
    h.f.doc.transact(() => {
      for (let i = 0; i < 60_000; i++) h.f.piece.insertEmbed(2, newTableOfContents());
    });
    const fs = h.version.flows.get(h.version.rootId);
    if (fs === undefined) throw new Error("no flow");
    expect(positionAtPoint(h.version, fs, h.f.piece, 30_000, 1)).toEqual(position(h.blockId(60_001), 0));
    expect(positionAtPoint(h.version, fs, h.f.piece, 30_000, -1)).toEqual(position(h.blockId(0), 1));
    expect(mapPosition(v0, h.version, position(h.blockId(0), 1), 1).position).not.toBeNull();
  });

  it("assoc anchors like a RelativePosition: text arriving at the start of the next piece moves an assoc-1 position", () => {
    const h = doc("ab");
    // "ab" in the first piece, the ¶ in a second one.
    h.f.doc.transact(() => {
      const mark = mapAt(h.f.piece, 2);
      const fresh = new Y.Text();
      h.f.piece.delete(2, 1);
      fresh.insertEmbed(0, mark.clone());
      h.f.flow.insert(1, [fresh]);
    });
    const v0 = h.version;
    const id = h.blockId(0);
    const second = h.f.flow.get(1);
    h.f.doc.transact(() => second.insert(0, "X"));
    expect(mapPosition(v0, h.version, position(id, 2), 1).position).toEqual(position(id, 3));
    expect(mapPosition(v0, h.version, position(id, 2), -1).position).toEqual(position(id, 2));
    const rel = toRelativePosition(h.version, position(id, 3), 1);
    if (rel === null) throw new Error("no rel");
    h.f.doc.transact(() => second.insert(0, "Y"));
    expect(fromRelativePosition(h.version, rel, 1)).toEqual(position(id, 4));
  });

  it("R15 never clusters across an embed; across a formatting change it does, and R14 applies after it", () => {
    const h = doc("");
    h.run(insertObject, "image", { props: { src: "a" } });
    h.run(insertText, "́x", {});
    expect(resolvePosition(h.version, position(h.blockId(0), 1))).toEqual(position(h.blockId(0), 1));
    const g = doc("");
    g.run(insertText, "ab", { link: "u" });
    g.run(insertText, "́c", {});
    const id = g.blockId(0);
    expect(resolvePosition(g.version, position(id, 2))).toEqual(position(id, 1)); // b + ◌́ is one cluster
    const atomic = { isAtomicMark: (k: string) => k === "link" };
    expect(resolvePosition(g.version, position(id, 2), atomic)).toEqual(position(id, 2));
    expect(resolvePosition(g.version, position(id, 1), atomic)).toEqual(position(id, 2)); // tie → end
  });
});

describe("merged text across parts (R15)", () => {
  it("raw storage: e | ◌́ split across pieces is one cluster", () => {
    const h = doc("");
    h.f.doc.transact(() => {
      h.f.piece.insert(0, "e");
      const fresh = new Y.Text();
      fresh.insert(0, "́");
      h.f.flow.insert(1, [fresh]);
      // move the ¶ after the accent: delete it from the first piece, give the second one a ¶
      h.f.piece.delete(1, 1);
      fresh.insertEmbed(1, newParagraphMark());
    });
    const id = h.blockId(0);
    expect(resolvePosition(h.version, position(id, 1))).toEqual(position(id, 0));
    h.caret(0, 2);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:"]);
  });

  it("raw storage: a Prepend (U+0600) before Latin text across a piece boundary is one cluster (GB9b), for snapping and Backspace", () => {
    const h = doc("");
    h.f.doc.transact(() => {
      h.f.piece.insert(0, "x\u0600");
      const fresh = new Y.Text();
      fresh.insert(0, "ab");
      h.f.flow.insert(1, [fresh]);
      h.f.piece.delete(2, 1);
      fresh.insertEmbed(2, newParagraphMark());
    });
    const id = h.blockId(0);
    expect(resolvePosition(h.version, position(id, 2))).toEqual(position(id, 1));
    h.caret(0, 3);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:xb"]);
  });

  it("raw storage: ZWJ at a piece edge before © (Extended_Pictographic below U+0300) is one cluster (GB11), for snapping and Delete", () => {
    const h = doc("");
    h.f.doc.transact(() => {
      h.f.piece.insert(0, "a\u{1F469}\u200D");
      const fresh = new Y.Text();
      fresh.insert(0, "\u00A9b");
      h.f.flow.insert(1, [fresh]);
      h.f.piece.delete(4, 1);
      fresh.insertEmbed(2, newParagraphMark());
    });
    const id = h.blockId(0);
    expect(resolvePosition(h.version, position(id, 4))).toEqual(position(id, 1));
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
  });

  it("a formatting change never splits a cluster: bold e + plain ◌́ (two peers), for snapping and Backspace", () => {
    const h = doc("");
    h.run(insertText, "e", { bold: true });
    const p = peer(h);
    const pt = p.doc.getMap("v4").get("doc");
    const flow = pt instanceof Y.Map ? pt.get("flow") : null;
    const first = flow instanceof Y.Array ? flow.get(0) : null;
    if (!(first instanceof Y.Text)) throw new Error("no piece");
    first.insert(1, "\u0301", { bold: null });
    p.sync();
    const id = h.blockId(0);
    expect(h.paragraphs()[0]?.inlineContent?.items.length).toBe(2);
    expect(resolvePosition(h.version, position(id, 1))).toEqual(position(id, 0));
    h.caret(0, 2);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:"]);
  });

  it("command path: an accent typed after a full piece goes to a sub-flow and still clusters with its base", () => {
    const h = doc("");
    h.f.doc.transact(() => {
      for (let i = 0; pieceStructCount(h.f.piece) < PIECE_SOFT_MAX; i++) h.f.piece.insert(i, "x", i % 2 === 0 ? { bold: true } : {});
      h.f.piece.insert(h.f.piece.length - 1, "e", {});
    });
    const id = h.blockId(0);
    const len = h.paragraphs()[0]?.inlineContent?.items.reduce((n, i) => n + (i.kind === "text" ? i.text.length : 1), 0) ?? 0;
    h.caret(0, len);
    h.run(insertText, "́", {});
    expect(h.version.flows.get(h.version.rootId)?.segments.length).toBeGreaterThan(1); // the accent is in another piece
    expect(resolvePosition(h.version, position(id, len))).toEqual(position(id, len - 1));
    h.caret(0, len + 1);
    h.run(deleteBackward);
    expect(h.paragraphs()[0]?.inlineContent?.items.reduce((n, i) => n + (i.kind === "text" ? i.text.length : 1), 0)).toBe(len - 1);
  });
});

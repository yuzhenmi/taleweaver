/**
 * H1 scenario tests: single-user undo / redo exactness for every M2 command, typing
 * coalescing, selection restore, X16 / X17, and the proof scripts that undo (r5 undo2 /
 * v1, review-r6 a2) ported to the model (flows of real pieces, through the commands).
 * The concurrent proof scripts that never undo live in `commands.test.ts`.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Harness, pair, sync, typeLines } from "./test-helpers/harness";
import { deleteBackward } from "./commands/delete-backward";
import { deleteForward } from "./commands/delete-forward";
import { deleteSelection } from "./commands/delete-selection";
import { plan } from "./commands/helpers/build-plan";
import { insertText } from "./commands/insert-text";
import { selectAll } from "./commands/selections";
import { setMarks } from "./commands/set-marks";
import { setParagraphAttrs } from "./commands/set-paragraph-attrs";
import { splitParagraph } from "./commands/split-paragraph";
import { deleteBlockObject } from "./commands/delete-block-object";
import { insertFootnote } from "./commands/insert-footnote";
import { insertHeaderFooter } from "./commands/insert-header-footer";
import { insertHorizontalRule } from "./commands/insert-horizontal-rule";
import { insertMarker } from "./commands/insert-marker";
import { insertObject } from "./commands/insert-object";
import { insertSectionBreak } from "./commands/insert-section-break";
import { insertTableOfContents } from "./commands/insert-table-of-contents";
import { paste } from "./commands/paste";
import { removeHeaderFooter } from "./commands/remove-header-footer";
import { removeMarker } from "./commands/remove-marker";
import { setObjectProps } from "./commands/set-object-props";
import { mapPosition } from "./mapping/map-position";
import { position } from "./position/model-position";
import { ITEM_KINDS, PIECES_KEY } from "./storage/keys";
import { PIECE_SOFT_MAX } from "./storage/limits";
import { kindOf } from "./storage/map-reads";
import { UNDO_COALESCE_PAUSE_MS } from "./history";

const type = (h: Harness, text: string): void => typeLines(h, text, insertText, splitParagraph);

function doc(text: string): Harness {
  const h = new Harness();
  type(h, text);
  return h;
}

/** Run `act`; undo and redo twice each: undo reads exactly as before (and restores the selection), redo as after. */
function expectExact(h: Harness, act: (h: Harness) => unknown): void {
  const before = h.read();
  const selBefore = h.readSelection();
  act(h);
  const after = h.read();
  const selAfter = h.readSelection();
  expect(after).not.toEqual(before);
  for (let i = 0; i < 2; i++) {
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    expect(h.readSelection()).toBe(selBefore);
    expect(h.redo()).toBe(true);
    expect(h.read()).toEqual(after);
    expect(h.readSelection()).toBe(selAfter);
  }
}

describe("H1 single-user undo / redo is exact for every command", () => {
  const cases: [string, (h: Harness) => void, (h: Harness) => unknown][] = [
    ["C1 type", (h) => h.caret(0, 1), (h) => h.run(insertText, "X", { bold: true })],
    ["C1 type-over across paragraphs", (h) => h.select([0, 1], [1, 1]), (h) => h.run(insertText, "Z")],
    ["C2 Enter mid", (h) => h.caret(0, 1), (h) => h.run(splitParagraph)],
    [
      "C2 Enter at a heading's end (next-style)",
      (h) => {
        h.run(setParagraphAttrs, { type: "heading" });
        h.caret(0, 2);
      },
      (h) => h.run(splitParagraph),
    ],
    [
      "C3 join (the first paragraph's style wins)",
      (h) => {
        h.caret(1, 0);
        h.run(setParagraphAttrs, { type: "heading" });
      },
      (h) => h.run(deleteBackward),
    ],
    ["C8 Delete join", (h) => h.caret(0, 2), (h) => h.run(deleteForward)],
    ["Backspace a grapheme", (h) => h.caret(0, 2), (h) => h.run(deleteBackward)],
    ["C9 range delete", (h) => h.select([0, 1], [2, 1]), (h) => h.run(deleteSelection)],
    ["setMarks", (h) => h.select([0, 0], [1, 1]), (h) => h.run(setMarks, { bold: true })],
    ["C16 paragraph attrs", (h) => h.select([0, 0], [1, 1]), (h) => h.run(setParagraphAttrs, { type: "heading", align: "center" })],
    ["C11 insert image", (h) => h.caret(0, 1), (h) => h.run(insertObject, "image", { props: { src: "a.png" } })],
    [
      "C12 set wrap",
      (h) => {
        h.caret(0, 1);
        h.run(insertObject, "image", { props: { src: "a.png" } });
      },
      (h) => h.run(setObjectProps, h.at(0, 1), { wrap: "left", w: 20, props: { alt: "x" } }),
    ],
    [
      "C4 delete an inline image",
      (h) => {
        h.caret(0, 1);
        h.run(insertObject, "image", { props: { src: "a.png" } });
      },
      (h) => h.run(deleteBackward),
    ],
    [
      "C4f range delete takes a float",
      (h) => {
        h.caret(0, 1);
        h.run(insertObject, "image", { props: { src: "a.png" } });
        h.run(setObjectProps, h.at(0, 1), { wrap: "right" });
        h.select([0, 0], [0, 3]);
      },
      (h) => h.run(deleteSelection),
    ],
    ["C13 insert a rule", (h) => h.caret(2, 1), (h) => h.run(insertHorizontalRule)],
    [
      "C4r Backspace after a rule paragraph",
      (h) => {
        h.caret(0, 2);
        h.run(insertHorizontalRule);
      },
      (h) => h.run(deleteBackward),
    ],
    ["C14 insert a TOC at k > 0", (h) => h.caret(1, 1), (h) => h.run(insertTableOfContents)],
    ["C14 insert a TOC at k = 0", (h) => h.caret(0, 0), (h) => h.run(insertTableOfContents)],
    [
      "C6 Backspace after a TOC",
      (h) => {
        h.caret(1, 0);
        h.run(insertTableOfContents);
      },
      (h) => h.run(deleteBackward),
    ],
    [
      "C10 delete a TOC by id",
      (h) => {
        h.caret(1, 0);
        h.run(insertTableOfContents);
      },
      (h) => h.run(deleteBlockObject, h.blockId(1)),
    ],
    [
      "C9 select-all over a leading TOC",
      (h) => {
        h.caret(0, 0);
        h.run(insertTableOfContents);
        const s = selectAll(h.version);
        if (s !== null) h.selection = s;
      },
      (h) => h.run(deleteSelection),
    ],
    ["C15 section break", (h) => h.caret(1, 1), (h) => h.run(insertSectionBreak)],
    [
      "C7 Backspace after [S]",
      (h) => {
        h.caret(1, 1);
        h.run(insertSectionBreak);
      },
      (h) => h.run(deleteBackward),
    ],
    [
      "C8 correction (Delete before [S] [TOC])",
      (h) => {
        h.caret(1, 0);
        h.run(insertSectionBreak);
        h.caret(2, 0);
        h.run(insertTableOfContents);
        h.caret(0, 2);
      },
      (h) => h.run(deleteForward),
    ],
    ["S1 footnote", (h) => h.caret(0, 1), (h) => h.run(insertFootnote)],
    [
      "S1 typing in a footnote body",
      (h) => {
        h.caret(0, 1);
        h.run(insertFootnote);
      },
      (h) => h.run(insertText, "note"),
    ],
    ["S2 insert a header", () => undefined, (h) => h.run(insertHeaderFooter, "header", "first")],
    [
      "S2 remove a header",
      (h) => {
        h.run(insertHeaderFooter, "header");
        h.run(insertText, "H");
        h.caret(0, 0);
      },
      (h) => h.run(removeHeaderFooter, "header"),
    ],
    ["insert a marker", (h) => h.select([0, 1], [1, 1]), (h) => h.run(insertMarker, "bm", "1")],
    [
      "remove a marker",
      (h) => {
        h.select([0, 1], [1, 1]);
        h.run(insertMarker, "bm", "1");
      },
      (h) => h.run(removeMarker, "bm", "1"),
    ],
    ["C17 paste paragraphs", (h) => h.caret(1, 1), (h) => h.run(paste, [{ k: "text", text: "p1" }, { k: "para", keys: { "p:type": "heading" } }, { k: "text", text: "p2" }])],
    ["C17 paste a TOC and a footnote", (h) => h.caret(1, 1), (h) => h.run(paste, [{ k: "toc" }, { k: "para" }, { k: "footnote", body: [{ k: "text", text: "n" }] }])],
    ["C17 paste a section", (h) => h.caret(2, 2), (h) => h.run(paste, [{ k: "para" }, { k: "S", keys: { "s:columnCount": 2 } }, { k: "hr" }, { k: "para" }])],
  ];
  for (const [name, setup, act] of cases) {
    it(name, () => {
      const h = doc("ab\ncd\nef");
      setup(h);
      expectExact(h, act);
    });
  }

  it("undo³ / redo³ return every intermediate read; restored ¶s get new ids (X21)", () => {
    const h = doc("ab\ncd");
    const reads = [h.read()];
    h.caret(0, 1);
    h.run(splitParagraph);
    reads.push(h.read());
    const split = h.blockId(0);
    h.run(insertTableOfContents);
    reads.push(h.read());
    h.caret(0, 0);
    h.run(setParagraphAttrs, { type: "heading" });
    reads.push(h.read());
    for (let i = 3; i > 0; i--) {
      h.undo();
      expect(h.read()).toEqual(reads[i - 1]);
    }
    for (let i = 1; i <= 3; i++) {
      h.redo();
      expect(h.read()).toEqual(reads[i]);
    }
    expect(h.blockId(0)).not.toBe(split);
  });

  it("C9 range delete across a whole sub-flow: exact, and undo / redo restore / delete its units in storage", () => {
    const h = doc("ab\ncd");
    h.caret(0, 1);
    // Units alternate formatting, so each is its own struct: mid-piece, the paste goes into a fresh sub-flow (X12).
    h.run(paste, Array.from({ length: PIECE_SOFT_MAX }, (_, i) => ({ k: "text" as const, text: "w", attrs: i % 2 === 0 ? { bold: true } : {} })));
    /** Live characters in the root piece's sub-flows. */
    const subUnits = (): number => {
      let n = 0;
      for (const op of h.f.piece.toDelta()) {
        const ins: unknown = op.insert;
        const pieces = ins instanceof Y.Map && kindOf(ins) === ITEM_KINDS.sub ? ins.get(PIECES_KEY) : null;
        if (pieces instanceof Y.Array) for (const p of pieces.toArray()) if (p instanceof Y.Text) n += p.toString().length;
      }
      return n;
    };
    expect(subUnits()).toBe(PIECE_SOFT_MAX);
    h.select([0, 0], [1, 1]);
    expectExact(h, (x) => x.run(deleteSelection));
    expect(subUnits()).toBe(0);
    h.undo();
    expect(subUnits()).toBe(PIECE_SOFT_MAX);
  });
});

describe("H1 coalescing (today's rule)", () => {
  it("typing within the pause is one entry; a pause, a different kind, a command or a caret move starts a new one", () => {
    const h = doc("");
    h.tick = 10;
    h.run(insertText, "a");
    h.run(insertText, "b");
    h.run(insertText, "c");
    h.tick = UNDO_COALESCE_PAUSE_MS;
    h.run(insertText, "d");
    h.tick = 10;
    h.run(deleteBackward);
    h.run(deleteBackward);
    h.run(insertText, "X");
    h.run(setParagraphAttrs, { type: "heading" });
    h.run(insertText, "Y");
    h.history.breakCoalescing();
    h.run(insertText, "Z");
    // A command that writes nothing still ends the run (its undo entry is empty: none is added).
    expect(h.history.apply(plan(h.version, [], () => h.selection), "command", h.selection)).not.toBeNull();
    h.run(insertText, "W");
    const steps: string[] = [];
    while (h.undo()) steps.push(h.dump().join("/"));
    expect(steps).toEqual(["heading:abXYZ", "heading:abXY", "heading:abX", "paragraph:abX", "paragraph:ab", "paragraph:abcd", "paragraph:abc", "paragraph:"]);
    expect(h.sel()).toBe("0:0");
  });

  it("a coalesced entry restores its first edit's selection; redo restores the last edit's", () => {
    const h = doc("xy");
    h.tick = 10;
    h.caret(0, 1);
    h.run(insertText, "a");
    h.run(insertText, "b");
    h.undo();
    expect(h.sel()).toBe("0:1");
    h.redo();
    expect(h.sel()).toBe("0:3");
    // clear() closes the open entry: the next edit within the pause starts a new one, with its own before-selection.
    h.history.clear();
    h.run(insertText, "c");
    expect(h.undo()).toBe(true);
    expect([h.dump(), h.sel()]).toEqual([["paragraph:xaby"], "0:3"]);
    expect(h.undo()).toBe(false);
  });
});

describe("H1 selection restore", () => {
  it("undo of a range delete re-selects the restored text (both directions); undo of a caret edit restores the caret", () => {
    const h = doc("abc\ndef");
    h.select([1, 2], [0, 1]);
    h.run(deleteSelection);
    h.undo();
    expect(h.sel()).toBe("1:2-0:1");
    h.select([0, 1], [1, 2]);
    h.run(insertText, "Z");
    h.undo();
    expect(h.sel()).toBe("0:1-1:2");
    h.caret(1, 0);
    h.run(deleteBackward);
    h.undo();
    expect(h.sel()).toBe("1:0");
  });

  it("an undo whose stored selection's flow a peer removed still undoes, with no selection to restore", () => {
    const [a, b] = pair("x\ny");
    a.caret(1, 0);
    a.run(insertTableOfContents);
    a.caret(0, 0);
    a.run(insertHeaderFooter, "header");
    a.run(insertText, "H"); // the caret is in the header
    a.run(deleteBlockObject, a.blockId(1));
    sync(a, b);
    b.caret(0, 0);
    b.run(removeHeaderFooter, "header");
    sync(a, b);
    expect(b.templateBodies()).toEqual([]);
    expect(a.history.undo()).toEqual({ selection: null });
    expect(a.dump()).toEqual(["paragraph:x", "toc", "paragraph:y"]);
  });
});

describe("H1 undo goes through the change pipeline", () => {
  it("an undo is one version with its dirty ids, and positions map across it exactly", () => {
    const h = doc("abc");
    h.caret(0, 1);
    h.run(insertText, "XY");
    const before = h.version;
    const changes: number[] = [];
    h.model.subscribe((c) => changes.push(c.dirtyIds.size));
    h.undo();
    expect(changes).toEqual([1]);
    expect(mapPosition(before, h.version, position(h.blockId(0), 3)).position).toEqual(position(h.blockId(0), 1));
  });
});

describe("X16 / X17", () => {
  it("X16: a local undo never undoes a peer's edit; a peer's undo stack holds only its own edits", () => {
    const [a, b] = pair("x");
    b.caret(0, 1);
    b.run(insertText, "REMOTE");
    sync(a, b);
    a.caret(0, 0);
    a.run(insertText, "A");
    sync(a, b);
    a.undo();
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:xREMOTE"]);
    expect(b.dump()).toEqual(a.dump());
    expect(a.undo()).toBe(true); // a's setup typing
    sync(a, b);
    expect(b.dump()).toEqual(["paragraph:REMOTE"]);
    expect(b.history.canUndo()).toBe(true);
    b.undo();
    expect(b.history.canUndo()).toBe(false);
  });

  it("X17: undo of a paste that created fresh pieces keeps a peer's text typed inside them", () => {
    const [a, b] = pair("ab");
    a.caret(0, 1);
    // Units alternate formatting, so each is its own struct: too many for one piece.
    a.run(paste, Array.from({ length: PIECE_SOFT_MAX }, (_, i) => ({ k: "text" as const, text: "w", attrs: i % 2 === 0 ? { bold: true } : {} })));
    // Mid-piece, the paste went into a fresh sub-flow (X12): the container A created.
    const isSub = (x: unknown): boolean => x instanceof Y.Map && kindOf(x) === ITEM_KINDS.sub;
    expect(a.f.piece.toDelta().some((op: { insert?: unknown }) => isSub(op.insert))).toBe(true);
    sync(a, b);
    b.caret(0, 600);
    b.run(insertText, "B");
    sync(a, b);
    a.undo();
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:aBb"]);
    expect(b.dump()).toEqual(a.dump());
  });
});

// ---------------------------------------------------------------------------
// Proof scripts that undo (r5 undo2 / v1, review-r6 a2), ported. A block object is a
// TOC here (tables are P2).
// ---------------------------------------------------------------------------

describe("proof scripts: r5 undo2", () => {
  it("#1 (Q1) both delete the same block object and both undo → two of it", () => {
    const [a, b] = pair("x\ny");
    a.caret(1, 0);
    a.run(insertTableOfContents);
    sync(a, b);
    for (const h of [a, b]) h.run(deleteBlockObject, h.blockId(1));
    sync(a, b);
    a.undo();
    b.undo();
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:x", "toc", "toc", "paragraph:y"]);
    expect(b.dump()).toEqual(a.dump());
  });

  // Under X16 the duplicate is the overlap ("o"); the script's `hello worldhello world` came from
  // null-origin undo managers that also captured the sync.
  it("#2 (Q1) overlapping deletes, both undo → the overlap is duplicated; #3 only A undoes → A's text is back, B's delete stays", () => {
    for (const both of [true, false]) {
      const [a, b] = pair("hello world");
      a.select([0, 0], [0, 8]);
      a.run(deleteSelection);
      b.select([0, 4], [0, 11]);
      b.run(deleteSelection);
      sync(a, b);
      a.undo();
      if (both) b.undo();
      sync(a, b);
      expect(a.dump()).toEqual([both ? "paragraph:hello woo world" : "paragraph:hello wo"]);
      expect(b.dump()).toEqual(a.dump());
    }
  });
});

describe("proof scripts: r5 v1 (non-table)", () => {
  it("#1 / #2 single user: split, join, undo ×2, redo ×2 and an attr undo are exact", () => {
    const h = doc("xy");
    h.run(setParagraphAttrs, { type: "heading" });
    h.caret(0, 1);
    expectExact(h, (x) => x.run(splitParagraph));
    h.caret(1, 0);
    expectExact(h, (x) => x.run(deleteBackward));
    expectExact(h, (x) => x.run(setParagraphAttrs, { align: "center" }));
  });

  it("#7 (Q4) both set a key; the LWW winner undoes → the key is absent (default), not the loser's value", () => {
    const [a, b] = pair("x");
    a.run(setParagraphAttrs, { align: "center" });
    b.run(setParagraphAttrs, { align: "right" });
    sync(a, b);
    const winner = a.dump()[0] === "paragraph(align=right):x" ? b : a;
    winner.undo();
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:x"]);
    expect(b.dump()).toEqual(a.dump());
  });
});

describe("proof scripts: review-r6 a2 (Q1 [S][S])", () => {
  it("both do C7 (or the C8 correction) on the same [S] and both undo → two [S], both client orders", () => {
    for (const ids of [[1, 2], [2, 1]] satisfies [number, number][]) {
      for (const corr of [false, true]) {
        const [a, b] = pair("x", ids);
        a.run(insertSectionBreak);
        if (corr) a.run(insertTableOfContents);
        else a.run(insertText, "y");
        sync(a, b);
        for (const h of [a, b]) {
          if (corr) h.caret(0, 1);
          else h.caret(1, 0);
          h.run(corr ? deleteForward : deleteBackward);
        }
        sync(a, b);
        expect(a.dump()).toEqual(corr ? ["paragraph:x", "toc", "paragraph:"] : ["paragraph:xy"]);
        a.undo();
        b.undo();
        sync(a, b);
        // `x¶¶[S][S]y¶` / `x¶[S][S][T]¶`: R4 reads the empty middle section.
        expect(a.dump()).toEqual(corr ? ["paragraph:x", "|", "|", "toc", "paragraph:"] : ["paragraph:x", "paragraph:", "|", "|", "paragraph:y"]);
        expect(b.dump()).toEqual(a.dump());
      }
    }
  });
});


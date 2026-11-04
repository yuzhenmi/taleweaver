/**
 * Scenario tests: one per command (r7 §5), single-user behaviour + the resulting version
 * (the harness also checks incremental == scratch after every command); then the
 * concurrent proof scripts that never undo.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { caretAt } from "./position/model-position";
import { idOf } from "./test-helpers/fixture";
import { Harness, pair, sync, typeLines } from "./test-helpers/harness";
import { insertUnits, mapsOf, units } from "./test-helpers/table";
import { deleteBackward } from "./commands/delete-backward";
import { deleteForward } from "./commands/delete-forward";
import { deleteSelection } from "./commands/delete-selection";
import { insertText } from "./commands/insert-text";
import { objectSelection, selectAll } from "./commands/selections";
import { setMarks } from "./commands/set-marks";
import { setParagraphAttrs } from "./commands/set-paragraph-attrs";
import { splitParagraph } from "./commands/split-paragraph";
import { deleteBlockObject } from "./commands/delete-block-object";
import type { FragmentItem } from "./commands/helpers/fragment";
import { insertField } from "./commands/insert-field";
import { insertFootnote } from "./commands/insert-footnote";
import { insertHeaderFooter } from "./commands/insert-header-footer";
import { insertHorizontalRule } from "./commands/insert-horizontal-rule";
import { insertLineBreak } from "./commands/insert-line-break";
import { insertMarker } from "./commands/insert-marker";
import { insertObject } from "./commands/insert-object";
import { insertSectionBreak } from "./commands/insert-section-break";
import { insertTableOfContents } from "./commands/insert-table-of-contents";
import { paste } from "./commands/paste";
import { removeHeaderFooter } from "./commands/remove-header-footer";
import { removeMarker } from "./commands/remove-marker";
import { setObjectProps } from "./commands/set-object-props";
import { markerRanges } from "./document/markers";
import { Model } from "./model";
import { applyPlan } from "./plan";
import { PIECE_SOFT_MAX } from "./storage/limits";
import { newField, newFootnoteOf, newObject, newParagraphMark, newTableOfContents } from "./storage/new-items";
import { pieceStructCount } from "./storage/pieces";
import type { Scalar } from "./storage/scalar";

/** A one-cell table holding one empty paragraph, and its storage length. */
const ONE_CELL = "⟦ ⟨r⟩ ⟨c⟩ ¶ ⟧";
const ONE_CELL_LEN = 5;
const type = (h: Harness, text: string): void => typeLines(h, text, insertText, splitParagraph);

function doc(text: string): Harness {
  const h = new Harness();
  type(h, text);
  return h;
}

describe("C1 type", () => {
  it("inserts at the caret and moves the caret after the text, inheriting the formatting before it", () => {
    const h = doc("ad");
    h.caret(0, 1);
    h.run(insertText, "bc");
    expect(h.dump()).toEqual(["paragraph:abcd"]);
    expect(h.sel()).toBe("0:3");
    h.select([0, 0], [0, 2]);
    h.run(setMarks, { bold: true });
    h.caret(0, 2);
    h.run(insertText, "X");
    const items = h.paragraphs()[0]?.inlineContent?.items;
    expect(items?.[0]).toEqual({ kind: "text", text: "abX", attrs: { bold: true } });
  });

  it("type-over deletes the range first (C9) and joins across paragraphs", () => {
    const h = doc("abc\ndef");
    h.select([0, 1], [1, 2]);
    h.run(insertText, "Z");
    expect(h.dump()).toEqual(["paragraph:aZf"]);
    expect(h.sel()).toBe("0:2");
  });
});

describe("C2 Enter", () => {
  it("splits at the caret; the head gets the new ¶ and the tail keeps the paragraph's id; caret at the tail's start", () => {
    const h = doc("abcd");
    const id = h.blockId(0);
    h.caret(0, 2);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["paragraph:ab", "paragraph:cd"]);
    expect(h.blockId(1)).toBe(id);
    expect(h.sel()).toBe("1:0");
  });

  it("at the end of a heading the new paragraph is Normal (next-style); mid-heading both halves stay headings", () => {
    const h = doc("Title");
    h.run(setParagraphAttrs, { type: "heading", level: 1 });
    h.caret(0, 2);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["heading(level=1):Ti", "heading(level=1):tle"]);
    h.caret(1, 3);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["heading(level=1):Ti", "heading(level=1):tle", "paragraph:"]);
  });

  it("one-shot attrs go to the head, except at offset 0 of a non-empty paragraph", () => {
    const h = doc("ab");
    h.run(setParagraphAttrs, { type: "list-item", listId: "L", listCounterOverride: 5 });
    h.caret(0, 1);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["list-item(listCounterOverride=5,listId=L):a", "list-item(listId=L):b"]);
    h.caret(0, 0);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["list-item(listId=L):", "list-item(listCounterOverride=5,listId=L):a", "list-item(listId=L):b"]);
  });

  it("Enter on an empty list item exits the list: outdent, then a plain paragraph", () => {
    const h = doc("");
    h.run(setParagraphAttrs, { type: "list-item", listId: "L", listLevel: 1 });
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["list-item(listId=L,listLevel=0):"]);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["paragraph:"]);
  });

  it("over a range deletes it, then splits", () => {
    const h = doc("abc\ndef");
    h.select([0, 1], [1, 2]);
    h.run(splitParagraph);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:f"]);
    expect(h.sel()).toBe("1:0");
  });
});

describe("C3 / C8 joins", () => {
  it("Backspace at a paragraph start joins; the first paragraph's style wins (G8); caret at the seam", () => {
    const h = doc("ab\ncd");
    h.caret(0, 0);
    h.run(setParagraphAttrs, { type: "heading", level: 2 });
    const second = h.blockId(1);
    h.caret(1, 0);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["heading(level=2):abcd"]);
    expect(h.blockId(0)).toBe(second);
    expect(h.sel()).toBe("0:2");
  });

  it("an empty default first paragraph loses: the survivor keeps its own style", () => {
    const h = doc("\ncd");
    h.caret(1, 0);
    h.run(setParagraphAttrs, { type: "heading", level: 1 });
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["heading(level=1):cd"]);
  });

  it("Backspace mid-paragraph deletes one grapheme; at the flow start it does nothing", () => {
    const h = doc("aéb");
    h.caret(0, 3);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
    h.caret(0, 0);
    expect(h.run(deleteBackward)).toBe(false);
  });

  it("Delete at the end joins with the next paragraph; at the flow's final ¶ it does nothing", () => {
    const h = doc("ab\ncd");
    h.caret(0, 2);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:abcd"]);
    expect(h.sel()).toBe("0:2");
    h.caret(0, 4);
    expect(h.run(deleteForward)).toBe(false);
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:acd"]);
  });

  it("next to a table, Backspace / Delete in a paragraph holding text do nothing (C5 / its C8 mirror); a rule beside a table is still C4r", () => {
    const mk = (debris: boolean): Harness => {
      const h = new Harness();
      h.f.doc.transact(() => {
        h.f.piece.insert(0, "P");
        if (!debris) h.f.piece.insertEmbed(1, newParagraphMark());
        const at = debris ? 1 : 2;
        insertUnits(h.f.piece, at, units(ONE_CELL));
        h.f.piece.insert(at + ONE_CELL_LEN, "Q");
      });
      return h;
    };
    const h = mk(false);
    const shape = h.dump();
    expect(shape).toEqual(["paragraph:P", "table", "paragraph:Q"]);
    h.caret(2, 0);
    expect(h.run(deleteBackward)).toBe(false);
    h.caret(0, 1);
    expect(h.run(deleteForward)).toBe(false);
    expect(h.dump()).toEqual(shape);
    const g = mk(true); // debris before the table
    g.caret(0, 1);
    expect(g.run(deleteForward)).toBe(false);
    expect(g.dump()).toEqual(["paragraph:P", "table", "paragraph:Q"]);
    // A rule paragraph between P and the table: Delete at P's end removes the whole rule paragraph.
    h.caret(0, 1);
    h.run(insertHorizontalRule);
    expect(h.dump()).toEqual(["paragraph:P", "paragraph:[hr]", "paragraph:", "table", "paragraph:Q"]);
    h.caret(1, 1);
    h.run(deleteForward); // join the empty paragraph into the rule paragraph
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(shape);
  });

  it("Backspace at a list item's start exits the list instead of joining", () => {
    const h = doc("a\nb");
    h.caret(1, 0);
    h.run(setParagraphAttrs, { type: "list-item", listId: "L" });
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:b"]);
  });
});

describe("C9 range delete", () => {
  it("deletes across paragraphs; the end paragraph's ¶ survives with the join keys", () => {
    const h = doc("abc\nmid\ndef");
    h.caret(0, 0);
    h.run(setParagraphAttrs, { align: "center" });
    h.select([2, 1], [0, 2]);
    h.run(deleteSelection);
    expect(h.dump()).toEqual(["paragraph(align=center):abef"]);
    expect(h.sel()).toBe("0:2");
  });
});

describe("C4 / C4f / G5 inline embeds", () => {
  it("Backspace / Delete next to an inline image or an [hr] deletes that one embed as a character", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(insertObject, "image", { props: { src: "a.png" } });
    expect(h.dump()).toEqual(["paragraph:a[img]b"]);
    expect(h.sel()).toBe("0:2");
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
    h.caret(0, 1);
    h.run(paste, [{ k: "hr" }]);
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
  });

  it("C4f: offsets around a float are one caret position; Backspace / Delete step over it; a range delete takes it", () => {
    const h = doc("abc");
    h.caret(0, 1);
    h.run(insertObject, "image", { props: { src: "a.png" } });
    h.run(setObjectProps, h.at(0, 1), { wrap: "left" });
    expect(h.dump()).toEqual(["paragraph:a[img:left]bc"]);
    h.caret(0, 2); // after the float: resolves before it
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:[img:left]bc"]);
    h.caret(0, 0);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:[img:left]c"]);
    h.select([0, 0], [0, 2]);
    h.run(deleteSelection);
    expect(h.dump()).toEqual(["paragraph:"]);
  });

  it("C3 keeps a float: the image stays anchored in the joined paragraph", () => {
    const h = doc("ab\ncd");
    h.caret(0, 2);
    h.run(insertObject, "image", { props: { src: "a.png" } });
    h.run(setObjectProps, h.at(0, 2), { wrap: "break" });
    h.caret(1, 0);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab[img:break]cd"]);
  });

  it("C12: setting inline deletes wrap; size and alt are written; a required prop cannot be removed", () => {
    const h = doc("");
    h.run(insertObject, "image", { props: { src: "a.png" } });
    h.run(setObjectProps, h.at(0, 0), { wrap: "right", w: 30, props: { alt: "cat" } });
    let img = h.paragraphs()[0]?.inlineContent?.items[0];
    expect(img).toMatchObject({ properties: { wrap: "right", width: 30, props: { src: "a.png", alt: "cat" } } });
    h.run(setObjectProps, h.at(0, 0), { wrap: null });
    img = h.paragraphs()[0]?.inlineContent?.items[0];
    expect(img?.kind === "embed" ? img.properties["wrap"] : "?").toBeUndefined();
    expect(() => setObjectProps(h.ctx(), h.at(0, 0), { props: { src: null } })).toThrow();
    expect(() => insertObject(h.ctx(), "acme:unregistered")).toThrow();
  });
});

describe("C13 / C4r rules", () => {
  it("C13 (G1 shape): the focus paragraph keeps its text and style, then a rule paragraph, then an empty Normal paragraph with the caret", () => {
    const h = doc("Title");
    h.run(setParagraphAttrs, { type: "heading", level: 1 });
    const id = h.blockId(0);
    h.caret(0, 2);
    h.run(insertHorizontalRule);
    expect(h.dump()).toEqual(["heading(level=1):Title", "paragraph:[hr]", "paragraph:"]);
    expect(h.blockId(2)).toBe(id); // every insert is before the old final ¶ (A1)
    expect(h.sel()).toBe("2:0");
    // Over a range: the selection is replaced first (C9), then the rule follows the joined paragraph; one undo entry.
    const g = doc("abc\ndef");
    g.caret(0, 0);
    g.run(setParagraphAttrs, { type: "heading", level: 1 });
    g.select([0, 1], [1, 2]);
    g.run(insertHorizontalRule);
    expect(g.dump()).toEqual(["heading(level=1):af", "paragraph:[hr]", "paragraph:"]);
    expect(g.sel()).toBe("2:0");
    g.undo();
    expect(g.dump()).toEqual(["heading(level=1):abc", "paragraph:def"]);
  });

  it("Backspace after a rule paragraph deletes it (C4r); typing beside the rule is ordinary text (X28 dropped); Backspace after [hr] deletes only it (G5)", () => {
    const h = doc("a");
    h.run(insertHorizontalRule);
    h.run(insertText, "b");
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:[hr]", "paragraph:b"]);
    h.caret(2, 0);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:b"]);
    h.caret(0, 1);
    h.run(insertHorizontalRule);
    h.caret(1, 1);
    h.run(insertText, "x");
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:[hr]x", "paragraph:", "paragraph:b"]);
    h.caret(1, 1);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:x", "paragraph:", "paragraph:b"]);
    // A marked rule is still a rule paragraph: its anchor edges stay, collapsed into the next paragraph.
    for (const [at, run] of [[[2, 0], deleteBackward], [[0, 1], deleteForward]] as const) {
      const g = doc("a");
      g.run(insertHorizontalRule);
      g.run(insertText, "b");
      g.select([1, 0], [1, 1]);
      g.run(insertMarker, "m", "1");
      expect(g.dump()).toEqual(["paragraph:a", "paragraph:[start][hr][end]", "paragraph:b"]);
      g.caret(at[0], at[1]);
      g.run(run);
      expect(g.dump()).toEqual(["paragraph:a", "paragraph:[start][end]b"]);
    }
  });

  it("Delete at the end of X before a rule paragraph deletes it; the flow's final ¶ / the ¶ before [S] stays (only [hr] goes)", () => {
    const h = doc("a");
    h.run(insertHorizontalRule);
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:"]);
    // A rule paragraph as the final paragraph: the final ¶ stays.
    h.caret(1, 0);
    h.run(paste, [{ k: "hr" }]);
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:"]);
  });

  it("a selected [hr] is a character under every command: Backspace, Delete and cut remove only it; typing over it makes a text paragraph", () => {
    for (const cmd of [deleteBackward, deleteForward, deleteSelection]) {
      const h = doc("a");
      h.run(insertHorizontalRule);
      h.run(insertText, "b");
      h.select([1, 0], [1, 1]);
      h.run(cmd);
      expect(h.dump()).toEqual(["paragraph:a", "paragraph:", "paragraph:b"]);
      expect(h.sel()).toBe("1:0");
    }
    const h = doc("a");
    h.run(insertHorizontalRule);
    h.run(insertText, "b");
    h.select([1, 0], [1, 1]);
    h.run(insertText, "t");
    expect(h.dump()).toEqual(["paragraph:a", "paragraph:t", "paragraph:b"]);
  });
});

describe("C14 / C6 / C10 table of contents", () => {
  it("k > 0 splits and puts the TOC before the tail; k = 0 puts it before the paragraph; caret at the tail", () => {
    const h = doc("abcd");
    h.caret(0, 2);
    h.run(insertTableOfContents, { depth: 3 });
    expect(h.dump()).toEqual(["paragraph:ab", "toc", "paragraph:cd"]);
    expect(h.sel()).toBe("2:0");
    expect(h.paragraphs()[1]?.attrs).toEqual({ depth: 3 });
    h.run(insertTableOfContents);
    // k = 0 after a block object: ¶M first, so W2 holds.
    expect(h.dump()).toEqual(["paragraph:ab", "toc", "paragraph:", "toc", "paragraph:cd"]);
    // Over a range: the selection is replaced first (C9), then C14's placement at its start.
    const g = doc("abc\ndef");
    g.select([0, 1], [1, 2]);
    g.run(insertTableOfContents);
    expect(g.dump()).toEqual(["paragraph:a", "toc", "paragraph:f"]);
    expect(g.sel()).toBe("2:0");
  });

  it("k = 0 after a table also puts ¶M first (W2), for insert and for a pasted leading TOC", () => {
    const mk = (): Harness => {
      const h = new Harness();
      h.f.doc.transact(() => {
        h.f.piece.insert(0, "P");
        h.f.piece.insertEmbed(1, newParagraphMark());
        insertUnits(h.f.piece, 2, units(ONE_CELL));
        h.f.piece.insert(2 + ONE_CELL_LEN, "Q");
      });
      h.caret(2, 0);
      return h;
    };
    const h = mk();
    h.run(insertTableOfContents);
    expect(h.dump()).toEqual(["paragraph:P", "table", "paragraph:", "toc", "paragraph:Q"]);
    const g = mk();
    g.run(paste, [{ k: "toc" }, { k: "para" }]);
    expect(g.dump()).toEqual(["paragraph:P", "table", "paragraph:", "toc", "paragraph:", "paragraph:Q"]);
  });

  it("Backspace after a TOC deletes it (C6); Delete before one deletes it; C10 deletes by id", () => {
    const h = doc("ab\ncd");
    h.caret(1, 0);
    h.run(insertTableOfContents);
    expect(h.dump()).toEqual(["paragraph:ab", "toc", "paragraph:cd"]);
    h.caret(2, 0);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab", "paragraph:cd"]);
    h.caret(1, 0);
    h.run(insertTableOfContents);
    h.caret(0, 2);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:ab", "paragraph:cd"]);
    h.caret(1, 0);
    h.run(insertTableOfContents);
    h.run(deleteBlockObject, h.blockId(1));
    expect(h.dump()).toEqual(["paragraph:ab", "paragraph:cd"]);
    expect(h.sel()).toBe("1:0");
  });
});

describe("C15 / C7 / C8 section breaks", () => {
  it("C15 splits and ends the head's section; s:* are copied and explicit h:* move to the new [S]", () => {
    const h = doc("abcd");
    h.run(insertHeaderFooter, "header");
    h.caret(0, 2);
    h.run(insertSectionBreak);
    expect(h.dump()).toEqual(["paragraph:ab", "|", "paragraph:cd"]);
    expect(h.sel()).toBe("1:0");
    const d = h.version;
    const [s1, s2] = d.flows.get(d.rootId)?.sections ?? [];
    expect(s1?.map.get("h:header:default")).toEqual(expect.any(String));
    expect(s2?.map.get("h:header:default")).toBeUndefined();
    // The tail section inherits the header (R5).
    const sec2 = d.trees.block.get(s2?.id ?? "");
    expect(sec2?.attrs["headerBlockId"]).toEqual(expect.any(String));
    // Over a range: the selection is replaced first (C9), then the split at its start.
    const g = doc("abc\ndef");
    g.select([0, 1], [1, 2]);
    g.run(insertSectionBreak);
    expect(g.dump()).toEqual(["paragraph:a", "|", "paragraph:f"]);
    expect(g.sel()).toBe("1:0");
  });

  it("C7: Backspace after [S] joins across it; C8: Delete before [S] joins too", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(insertSectionBreak);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
    expect(h.sel()).toBe("0:1");
    h.run(insertSectionBreak);
    h.caret(0, 1);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
  });

  it("C8 correction: x¶ [S] [U] ¶ → Delete at the end of x deletes only [S]", () => {
    const h = doc("x\ny");
    h.caret(1, 0);
    h.run(insertSectionBreak); // x¶ ¶N [S] y¶
    h.caret(2, 0);
    h.run(insertTableOfContents); // [S] then the TOC before y
    expect(h.dump()).toEqual(["paragraph:x", "paragraph:", "|", "toc", "paragraph:y"]);
    h.caret(1, 0);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["paragraph:x", "paragraph:", "toc", "paragraph:y"]);
  });
});

describe("inline atoms: line break, page field", () => {
  it("Shift+Enter inserts a line break: one unit, one caret stop, Backspace takes it; undo / paste", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(insertLineBreak);
    expect(h.dump()).toEqual(["paragraph:a[br]b"]);
    expect(h.sel()).toBe("0:2");
    // Schema 3's read shape.
    expect(h.paragraphs()[0]?.inlineContent?.items[1]).toMatchObject({ kind: "embed", embedType: "hard-break", properties: {} });
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab"]);
    h.undo();
    expect(h.dump()).toEqual(["paragraph:a[br]b"]);
    h.caret(0, 3);
    h.run(paste, [{ k: "lineBreak" }, { k: "text", text: "c" }]);
    expect(h.dump()).toEqual(["paragraph:a[br]b[br]c"]);
  });

  it("a page field goes only into a header / footer (today's placement); fields read with a default number style", () => {
    const h = doc("ab");
    expect(h.run(insertField, "page-number")).toBe(false);
    expect(h.run(paste, [{ k: "field", field: "page-number" }])).toBe(false);
    expect(() => insertField(h.ctx(), "page-total")).toThrow();
    h.run(insertHeaderFooter, "header");
    const hp = [...h.version.trees.templateContent.entries()].map(([, b]) => b).find((b) => b.inlineContent !== null);
    if (hp === undefined) throw new Error("no header paragraph");
    h.selection = caretAt(hp.id, 0);
    h.run(insertField, "page-number", "lower-roman");
    expect(h.templateBodies()).toEqual([["paragraph:[field:page-number]"]]);
    const item = [...h.version.trees.templateContent.entries()].map(([, b]) => b).find((b) => b.inlineContent !== null)?.inlineContent?.items[0];
    expect(item).toMatchObject({ kind: "embed", embedType: "page-field", properties: { fieldKind: "page-number", numberStyle: "lower-roman" } });
    expect(h.selection.focus.offset).toBe(1);
    h.undo();
    expect(h.templateBodies()).toEqual([["paragraph:"]]);
    // A peer's field with an unknown style reads as decimal; an unknown field kind is inert.
    h.f.doc.transact(() => {
      h.f.piece.insertEmbed(0, newField("page-count", "bullet"));
      h.f.piece.insertEmbed(0, newField("bogus", "decimal"));
    });
    expect(h.dump()).toEqual(["paragraph:[field:page-count]ab"]);
    expect(h.paragraphs()[0]?.inlineContent?.items[0]).toMatchObject({ properties: { fieldKind: "page-count", numberStyle: "decimal" } });
  });
});

describe("S1 footnotes, S2 headers / footers, markers", () => {
  it("S1 inserts an anchor whose body holds one ¶; the caret goes into the body; not inside a body", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(insertFootnote);
    expect(h.dump()).toEqual(["paragraph:a[fn]b"]);
    expect(h.footnoteBodies()).toEqual([["paragraph:"]]);
    h.run(insertText, "note");
    expect(h.footnoteBodies()).toEqual([["paragraph:note"]]);
    expect(h.run(insertFootnote)).toBe(false);
  });

  it("S2 inserts a body and links it (idempotent: the caret goes into the existing one); remove sets none and deletes it", () => {
    const h = doc("ab");
    h.run(insertHeaderFooter, "footer");
    expect(h.templateBodies()).toEqual([["paragraph:"]]);
    h.run(insertText, "F");
    h.caret(0, 0);
    h.run(insertHeaderFooter, "footer");
    expect(h.templateBodies()).toEqual([["paragraph:F"]]);
    h.caret(0, 0);
    h.run(removeHeaderFooter, "footer");
    expect(h.templateBodies()).toEqual([]);
    expect(h.version.docMap.get("h:footer:default")).toBe("none");
  });

  it("markers wrap the selection (zero-width at a caret) and are removed by key", () => {
    const h = doc("abc");
    h.select([0, 1], [0, 2]);
    h.run(insertMarker, "bm", "1");
    expect(h.dump()).toEqual(["paragraph:a[start]b[end]c"]);
    expect(markerRanges(h.version).get("bm\u00001")).toMatchObject({ start: { offset: 1 }, end: { offset: 3 } });
    expect(() => insertMarker(h.ctx(), "bm", "1")).toThrow();
    h.run(removeMarker, "bm", "1");
    expect(h.dump()).toEqual(["paragraph:abc"]);
    h.caret(0, 1);
    h.run(insertMarker, "bm", "2");
    expect(h.dump()).toEqual(["paragraph:a[start][end]bc"]);
    // A range delete never deletes an anchor edge (Word bookmarks): those at its ends stay, one inside moves to the
    // collapse point (the pair shrinks), a pair inside collapses there.
    const g = doc("abcd");
    g.select([0, 1], [0, 3]);
    g.run(insertMarker, "bm", "1"); // a[start]bc[end]d
    g.select([0, 1], [0, 5]);
    g.run(deleteSelection);
    expect(g.dump()).toEqual(["paragraph:a[start][end]d"]);
    g.select([0, 0], [0, 4]);
    g.run(deleteSelection);
    expect(g.dump()).toEqual(["paragraph:[start][end]"]);
    const k = doc("abcd\nef");
    k.select([0, 1], [1, 1]);
    k.run(insertMarker, "bm", "1"); // a[start]bcd¶ e[end]f
    k.select([0, 0], [0, 3]);
    k.run(deleteSelection);
    expect(k.dump()).toEqual(["paragraph:[start]cd", "paragraph:e[end]f"]);
    k.select([0, 2], [1, 3]);
    k.run(deleteSelection);
    expect(k.dump()).toEqual(["paragraph:[start]c[end]"]);
    expect(markerRanges(k.version).get("bm\u00001")).toMatchObject({ start: { offset: 0 }, end: { offset: 2 } });
    // In a table cell of a footnote body: cells are part of their flow.
    const body = new Y.Text();
    const cellUnits = units("⟦ ⟨r⟩ ⟨c⟩ cell¶ ⟧ ¶");
    insertUnits(body, 0, cellUnits);
    h.f.doc.transact(() => h.f.piece.insertEmbed(0, newFootnoteOf(body)));
    const cellMark = mapsOf(cellUnits)[2];
    const cell = h.version.trees.embedContent.get(cellMark === undefined ? "" : idOf(cellMark))?.firstChildId ?? "";
    h.selection = { anchor: { blockId: cell, offset: 1 }, focus: { blockId: cell, offset: 3 } };
    h.run(insertMarker, "bm", "3");
    expect(markerRanges(h.version).get("bm\u00003")).toMatchObject({ start: { blockId: cell, offset: 1 }, end: { blockId: cell, offset: 4 } });
    expect(() => insertMarker(h.ctx(), "bm", "3")).toThrow();
    expect(h.run(removeMarker, "bm", "3")).toBe(true);
    expect(body.toString()).toBe("cell");
  });
});

describe("C17 paste (G6)", () => {
  it("a payload with no ¶ is typed", () => {
    const h = doc("ad");
    h.caret(0, 1);
    h.run(paste, [{ k: "text", text: "b" }, { k: "text", text: "c", attrs: { bold: true } }]);
    expect(h.dump()).toEqual(["paragraph:abcd"]);
    expect(h.sel()).toBe("0:3");
  });

  it("multi-paragraph text at k > 0: the first paragraph continues the head (carrying the pasted ¶'s keys), the last joins the tail", () => {
    const h = doc("xy");
    h.caret(0, 1);
    h.run(paste, [{ k: "text", text: "p1" }, { k: "para", keys: { "p:type": "heading" } }, { k: "text", text: "p2" }]);
    expect(h.dump()).toEqual(["heading:xp1", "paragraph:p2y"]);
    expect(h.sel()).toBe("1:2");
  });

  it("a payload that starts with a block object splits at k > 0; at k = 0 after a block object it gets ¶M first", () => {
    const h = doc("xy");
    h.caret(0, 1);
    h.run(paste, [{ k: "toc" }, { k: "para" }, { k: "text", text: "t" }]);
    expect(h.dump()).toEqual(["paragraph:x", "toc", "paragraph:", "paragraph:ty"]);
    h.caret(2, 0);
    h.run(paste, [{ k: "toc" }, { k: "para" }]);
    expect(h.dump()).toEqual(["paragraph:x", "toc", "paragraph:", "toc", "paragraph:", "paragraph:", "paragraph:ty"]);
  });

  it("a pasted footnote carries its body; a pasted [S] drops h:*; malformed payloads throw", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(paste, [{ k: "footnote", body: [{ k: "text", text: "n" }] }]);
    expect(h.footnoteBodies()).toEqual([["paragraph:n"]]);
    h.caret(0, 3);
    h.run(paste, [{ k: "para" }, { k: "S", keys: { "s:columnCount": 2, "h:header:default": "x" } }, { k: "text", text: "z" }]);
    expect(h.dump()).toEqual(["paragraph:a[fn]b", "|", "paragraph:z"]);
    expect(h.version.flows.get(h.version.rootId)?.sections[0]?.map.get("h:header:default")).toBeUndefined();
    expect(() => paste(h.ctx(), [{ k: "text", text: "a" }, { k: "toc" }])).toThrow();
    // A kind its target cannot hold refuses the whole payload, never throws — inside a pasted footnote's body too; a rule goes anywhere text does.
    expect(paste(h.ctx(), [{ k: "text", text: "q" }, { k: "footnote", body: [{ k: "toc" }, { k: "para" }] }])).toBeNull();
    h.caret(0, 1);
    h.run(paste, [{ k: "footnote", body: [{ k: "hr" }] }]);
    expect(h.footnoteBodies()).toContainEqual(["paragraph:[hr]"]);
  });
});

describe("review fixes", () => {
  it("Backspace at a paragraph start preceded only by markers joins and keeps the markers", () => {
    const h = doc("ab\ncd");
    h.caret(1, 0);
    h.run(insertMarker, "bm", "1");
    h.caret(1, 2);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:ab[start][end]cd"]);
    expect(h.sel()).toBe("0:4");
  });

  it("¶ mark props: typing at a paragraph's end and formatting over a ¶ carry into a new / empty paragraph", () => {
    const h = doc("ab");
    h.run(insertText, "C", { bold: true });
    h.run(splitParagraph);
    h.run(insertText, "d");
    expect(h.paragraphs()[1]?.inlineContent?.items[0]).toMatchObject({ text: "d", attrs: { bold: true } });
    const g = doc("a\n\nb");
    g.select([0, 0], [2, 1]);
    g.run(setMarks, { bold: true });
    g.caret(1, 0);
    g.run(insertText, "x");
    expect(g.paragraphs()[1]?.inlineContent?.items[0]).toMatchObject({ text: "x", attrs: { bold: true } });
  });

  it("type-over takes the first selected character's formatting, never an atomic mark", () => {
    const h = new Harness(1, { isAtomicMark: (k) => k === "field" });
    typeLines(h, "a", insertText, splitParagraph);
    h.run(insertText, "B", { bold: true, field: "f" });
    h.run(insertText, "c", {});
    h.select([0, 1], [0, 2]);
    h.run(insertText, "x");
    expect(h.paragraphs()[0]?.inlineContent?.items[1]).toMatchObject({ text: "x", attrs: { bold: true } });
    expect(h.paragraphs()[0]?.inlineContent?.items[1]?.attrs["field"]).toBeUndefined();
  });

  it("a non-inclusive mark is dropped at its edge and kept strictly inside it (also across a format change)", () => {
    const h = new Harness(1, { isInclusiveMark: (k) => k !== "link" });
    typeLines(h, "a", insertText, splitParagraph);
    h.run(insertText, "LI", { link: "u" });
    h.run(insertText, "NK", { link: "u", bold: true });
    h.run(insertText, "z", {});
    h.caret(0, 3);
    h.run(insertText, "1"); // between LI and NK: the same link on both sides
    h.caret(0, 6);
    h.run(insertText, "2"); // at the link's end
    const items = h.paragraphs()[0]?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? [i.text, i.attrs["link"] ?? "-", i.attrs["bold"] ?? "-"] : "?"))).toEqual([
      ["a", "-", "-"],
      ["LI1", "u", "-"],
      ["NK", "u", true],
      ["2", "-", true], // bold is inclusive and continues; the link does not
      ["z", "-", "-"],
    ]);
  });

  it("C10 deletes a TOC however it is followed ([T][U]¶, [T][S])", () => {
    const h = doc("x");
    h.caret(0, 0);
    h.run(insertTableOfContents);
    h.caret(1, 0);
    h.run(insertSectionBreak);
    // x's paragraph is now [T] ¶N [S] x¶: put a second TOC right after the first (a peer's state). The first reads
    // an implicit empty paragraph after it.
    h.f.doc.transact(() => h.f.piece.insertEmbed(1, newTableOfContents()));
    expect(h.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:", "|", "paragraph:x"]);
    h.run(deleteBlockObject, h.blockId(0));
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    // [T][S]: a TOC directly before an [S] reads its implicit paragraph too: a caret stop whose first write creates
    // its ¶ (X5), in the same undo entry.
    h.f.doc.transact(() => h.f.piece.delete(1, 1));
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    h.caret(1, 0);
    h.run(insertText, "q");
    expect(h.dump()).toEqual(["toc", "paragraph:q", "|", "paragraph:x"]);
    expect(h.sel()).toBe("1:1");
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    // Delete from the implicit paragraph: its ¶ is created and [S] goes (the join), in one undo entry.
    h.caret(1, 0);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["toc", "paragraph:x"]);
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    // A range from / to the implicit paragraph: the marker edge goes in with its ¶ (no debris), exact undo.
    h.select([1, 0], [2, 1]);
    h.run(insertMarker, "m", "1");
    expect(h.dump()).toEqual(["toc", "paragraph:[start]", "|", "paragraph:x[end]"]);
    expect(h.blockId(1)).not.toContain("/"); // a real ¶, not the implicit / debris paragraph
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    // Type-over of an object selection in [T][T][S]: the object goes, the text goes in the paragraph after it,
    // created — `[T] z¶ [S]` (before, no paragraph followed it: a no-op); undo is exact.
    h.f.doc.transact(() => h.f.piece.insertEmbed(0, newTableOfContents()));
    expect(h.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:", "|", "paragraph:x"]);
    const second = objectSelection(h.version, h.blockId(2));
    if (second === null) throw new Error("no selection");
    h.selection = second;
    h.run(insertText, "z");
    expect(h.dump()).toEqual(["toc", "paragraph:z", "|", "paragraph:x"]);
    expect(h.sel()).toBe("1:1");
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:", "|", "paragraph:x"]);
    // A range ending in an implicit paragraph (and starting in one): both edges go in with their ¶s.
    h.select([1, 0], [3, 0]);
    h.run(insertMarker, "m", "2");
    expect(h.dump()).toEqual(["toc", "paragraph:[start]", "toc", "paragraph:[end]", "|", "paragraph:x"]);
    expect([h.blockId(1), h.blockId(3)].filter((id) => id.includes("/"))).toEqual([]); // both real ¶s
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:", "|", "paragraph:x"]);
    // Delete from an implicit paragraph followed by a block object: only the object goes (the `only()` branch).
    h.caret(1, 0);
    h.run(deleteForward);
    expect(h.dump()).toEqual(["toc", "paragraph:", "|", "paragraph:x"]);
    h.undo();
    expect(h.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:", "|", "paragraph:x"]);
    h.f.doc.transact(() => h.f.piece.delete(0, 1));
    h.run(deleteBlockObject, h.blockId(0));
    expect(h.dump()).toEqual(["|", "paragraph:x"]);
  });

  it("C4r Backspace after `[T] [hr]¶M` deletes the whole rule paragraph: y's ¶ satisfies W2", () => {
    const h = doc("y");
    h.caret(0, 0);
    h.run(insertTableOfContents);
    h.caret(1, 0);
    h.run(paste, [{ k: "hr" }, { k: "para" }]);
    expect(h.dump()).toEqual(["toc", "paragraph:[hr]", "paragraph:y"]);
    h.caret(2, 0);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["toc", "paragraph:y"]);
  });

  it("select-all takes leading block objects (AllSelection); an object selection exactly its object (NodeSelection, C10)", () => {
    const h = doc("ab\ncd");
    h.caret(0, 0);
    h.run(insertTableOfContents);
    expect(h.dump()).toEqual(["toc", "paragraph:ab", "paragraph:cd"]);
    // Type-over of the first character keeps the leading TOC.
    h.select([1, 0], [1, 1]);
    h.run(insertText, "Z");
    expect(h.dump()).toEqual(["toc", "paragraph:Zb", "paragraph:cd"]);
    const all = selectAll(h.version);
    if (all === null) throw new Error("no selection");
    h.selection = all;
    // A command's selection mapping keeps a select-all; an object selection refuses formatting.
    h.run(setParagraphAttrs, { type: "heading" });
    expect(h.readSelection()).toBe("all 0");
    expect(h.dump()).toEqual(["toc", "heading:Zb", "heading:cd"]);
    h.run(deleteSelection);
    expect(h.dump()).toEqual(["heading:"]);
    h.run(setParagraphAttrs, { type: "paragraph" });
    // A TOC's object selection deletes just the TOC.
    h.run(insertText, "q");
    h.caret(0, 1);
    h.run(insertTableOfContents);
    expect(h.dump()).toEqual(["paragraph:q", "toc", "paragraph:"]);
    const obj = objectSelection(h.version, h.blockId(1));
    if (obj === null) throw new Error("no selection");
    h.selection = obj;
    expect(h.run(setParagraphAttrs, { type: "heading" })).toBe(false);
    h.run(deleteBackward);
    expect(h.dump()).toEqual(["paragraph:q", "paragraph:"]);
    expect(h.sel()).toBe("1:0");
    // Select-all + type-over replaces a leading TOC too.
    h.caret(0, 0);
    h.run(insertTableOfContents);
    const all2 = selectAll(h.version);
    if (all2 === null) throw new Error("no selection");
    h.selection = all2;
    h.run(insertText, "Y");
    expect(h.dump()).toEqual(["paragraph:Y"]);
    // Tables are block objects too. `toc | table | P` (concurrent W2 break: the TOC's implicit paragraph between):
    // each object selection covers exactly its object (Word / GDocs), select-all both.
    const g = new Harness();
    g.f.doc.transact(() => {
      g.f.piece.insertEmbed(0, newTableOfContents());
      insertUnits(g.f.piece, 1, units(ONE_CELL));
      g.f.piece.insert(1 + ONE_CELL_LEN, "P");
    });
    expect(g.dump()).toEqual(["toc", "paragraph:", "table", "paragraph:P"]);
    for (const [i, left] of [[0, ["table", "paragraph:P"]], [2, ["toc", "paragraph:P"]]] as const) {
      const sel = objectSelection(g.version, g.blockId(i));
      if (sel === null) throw new Error("no selection");
      g.selection = sel;
      g.run(deleteSelection);
      expect(g.dump()).toEqual(left);
      g.undo();
      // C10 by id: the same single object, whatever its block category.
      g.run(deleteBlockObject, g.blockId(i));
      expect(g.dump()).toEqual(left);
      g.undo();
    }
    const both = selectAll(g.version);
    if (both === null) throw new Error("no selection");
    g.selection = both;
    g.run(deleteSelection);
    expect(g.dump()).toEqual(["paragraph:"]);
    g.undo();
    g.f.doc.transact(() => g.f.piece.delete(0, 1)); // drop the TOC: a leading table
    expect(g.dump()).toEqual(["table", "paragraph:P"]);
    const all3 = selectAll(g.version);
    if (all3 === null) throw new Error("no selection");
    g.selection = all3;
    g.run(deleteSelection);
    expect(g.dump()).toEqual(["paragraph:"]);
    // Type-over of an object selection in `a¶ T1 T2 P`: the object goes, the text goes in the paragraph after it (T1's
    // implicit one, created; T2's P), the caret right after it.
    const k = new Harness();
    k.f.doc.transact(() => {
      k.f.piece.insert(0, "a");
      k.f.piece.insertEmbed(1, newParagraphMark());
      k.f.piece.insertEmbed(2, newTableOfContents());
      k.f.piece.insertEmbed(3, newTableOfContents());
      k.f.piece.insert(4, "P");
    });
    expect(k.dump()).toEqual(["paragraph:a", "toc", "paragraph:", "toc", "paragraph:P"]);
    for (const [i, after, sel] of [
      [1, ["paragraph:a", "paragraph:xy", "toc", "paragraph:P"], "1:2"],
      [3, ["paragraph:a", "toc", "paragraph:xyP"], "2:2"],
    ] as const) {
      const o = objectSelection(k.version, k.blockId(i));
      if (o === null) throw new Error("no selection");
      k.selection = o;
      k.run(insertText, "xy");
      expect(k.dump()).toEqual(after);
      expect(k.sel()).toBe(sel);
      k.undo();
    }
    // A section command reads an object selection's section (the paragraph after the object's).
    const t = objectSelection(k.version, k.blockId(1));
    if (t === null) throw new Error("no selection");
    k.selection = t;
    k.run(insertHeaderFooter, "header");
    expect(k.templateBodies()).toEqual([["paragraph:"]]);
  });

  it("Apply inside an open transaction is refused; invalid attrs / props throw at Plan time", () => {
    const h = doc("ab");
    const p = insertText(h.ctx(), "x");
    if (p === null) throw new Error("no plan");
    let out: unknown = "unset";
    h.f.doc.transact(() => {
      out = applyPlan(h.model, p, h.origin);
    });
    expect(out).toBeNull();
    expect(h.dump()).toEqual(["paragraph:ab"]);
    const bad: Record<string, unknown> = { bold: { nested: true } };
    expect(() => insertText(h.ctx(), "x", bad)).toThrow();
    expect(() => paste(h.ctx(), [{ k: "text", text: "x", attrs: bad }])).toThrow();
    const props: Record<string, Scalar> = { src: "a" };
    Reflect.set(props, "alt", { nested: true });
    expect(() => insertObject(h.ctx(), "image", { props })).toThrow();
  });

  it("C12 may patch an object that already reads as a placeholder", () => {
    const h = doc("");
    h.f.doc.transact(() => h.f.piece.insertEmbed(0, newObject("image", {})));
    expect(() => setObjectProps(h.ctx(), h.at(0, 0), { wrap: "left" })).not.toThrow();
  });
});

describe("busy model (stale plans)", () => {
  it("a plan applied from a model listener or a Yjs observer is refused; the final ¶ survives", () => {
    const h = doc("ab");
    const results: (unknown)[] = [];
    let armed = true;
    const off = h.model.subscribe((c) => {
      if (!armed) return;
      armed = false;
      for (let i = 0; i < 2; i++) {
        const p = deleteBackward({ version: c.after, selection: caretAt(h.blockId(0), 0) });
        results.push(p === null ? "none" : applyPlan(h.model, p, h.origin));
      }
    });
    h.run(insertText, "c");
    off();
    expect(results.every((x) => x === null || x === "none")).toBe(true);
    expect(h.dump()).toEqual(["paragraph:abc"]);
    // A remote update's observer.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.f.doc));
    const piece = peer.getMap("v4").get("doc");
    const flow = piece instanceof Y.Map ? piece.get("flow") : null;
    const pt = flow instanceof Y.Array ? flow.get(0) : null;
    if (!(pt instanceof Y.Text)) throw new Error("no piece");
    pt.insert(0, "z");
    let fromObserver: unknown = "unset";
    const obs = (): void => {
      const p = insertText({ version: h.model.version, selection: caretAt(h.blockId(0), 0) }, "q");
      fromObserver = p === null ? "none" : applyPlan(h.model, p, h.origin);
    };
    h.f.doc.getMap("v4").observeDeep(obs);
    Y.applyUpdate(h.f.doc, Y.encodeStateAsUpdate(peer));
    h.f.doc.getMap("v4").unobserveDeep(obs);
    expect(fromObserver).toBeNull();
    expect(h.dump()).toEqual(["paragraph:zabc"]);
    expect(h.model.busy).toBe(false);
  });

  it("documented precondition: a model constructed inside a transaction reads not-busy until it ends, then tracks", () => {
    const h = doc("ab");
    const m = h.f.doc.transact(() => {
      const late = new Model(h.f.doc);
      expect(late.busy).toBe(false); // missed beforeAllTransactions
      return late;
    });
    expect(h.f.doc.transact(() => m.busy)).toBe(true);
    expect(m.busy).toBe(false);
    m.destroy();
  });
});

describe("write boundaries and R17 holders", () => {
  it("only null / strings / finite numbers / booleans are written; empty keys are refused; a peer's bigint never makes a Plan throw", () => {
    const h = new Harness(1, { isAtomicMark: (k) => k === "field", isInclusiveMark: (k) => k !== "link" });
    typeLines(h, "ab", insertText, splitParagraph);
    expect(() => insertText(h.ctx(), "x", { size: Number.NaN })).toThrow();
    expect(() => insertText(h.ctx(), "x", { f: () => 1 })).toThrow();
    expect(() => insertText(h.ctx(), "x", { b: BigInt(1) })).toThrow();
    h.caret(0, 0);
    h.run(insertObject, "image", { props: { src: "a" } });
    expect(() => setObjectProps(h.ctx(), h.at(0, 0), { props: { "": "x" } })).toThrow();
    // A peer stores bigint-holding formatting values.
    h.f.doc.transact(() => h.f.piece.insert(2, "PQ", { link: { n: BigInt(1) }, field: { n: BigInt(2) } }));
    for (let o = 0; o <= 5; o++) {
      h.caret(0, o);
      expect(() => insertText(h.ctx(), "z")).not.toThrow();
      expect(() => deleteBackward(h.ctx())).not.toThrow();
    }
  });

  it("paste and markers into an R17 empty holder give it a ¶; big pasted footnote bodies and first pieces are chunked", () => {
    const h = doc("ab");
    h.f.doc.transact(() => {
      const body = new Y.Map<unknown>();
      body.set("flow", new Y.Array<Y.Text>());
      const fn = new Y.Map<unknown>();
      fn.set("k", "footnote");
      fn.set("body", body);
      h.f.piece.insertEmbed(1, fn);
    });
    const bodyId = [...h.version.flows.entries()].find(([, fs]) => fs.tree === "embedContent")?.[0] ?? "";
    expect(h.footnoteBodies()).toEqual([["paragraph:"]]);
    h.selection = caretAt(`${bodyId}/end`, 0);
    h.run(insertMarker, "bm", "1");
    expect(h.footnoteBodies()).toEqual([["paragraph:[start][end]"]]);
    const g = doc("ab");
    g.f.doc.transact(() => {
      const body = new Y.Map<unknown>();
      body.set("flow", new Y.Array<Y.Text>());
      const fn = new Y.Map<unknown>();
      fn.set("k", "footnote");
      fn.set("body", body);
      g.f.piece.insertEmbed(1, fn);
    });
    const gBody = [...g.version.flows.entries()].find(([, fs]) => fs.tree === "embedContent")?.[0] ?? "";
    g.selection = caretAt(`${gBody}/end`, 0);
    const many: FragmentItem[] = [];
    for (let i = 0; i < 600; i++) many.push({ k: "text", text: "w", attrs: i % 2 === 0 ? { bold: true } : {} }, { k: "para" });
    g.run(paste, many);
    expect(g.footnoteBodies()[0]?.length).toBe(601);
    const flowPieces = (fs: { readonly segments: readonly { readonly piece: Y.Text }[] } | undefined): Y.Text[] => [...new Set(fs?.segments.map((x) => x.piece))];
    const gPieces = flowPieces(g.version.flows.get(gBody));
    expect(gPieces.length).toBeGreaterThan(1);
    for (const p of gPieces) expect(pieceStructCount(p)).toBeLessThanOrEqual(PIECE_SOFT_MAX);
    // A pasted footnote whose body is big.
    g.caret(0, 0);
    g.run(paste, [{ k: "footnote", body: many }]);
    const bodies = [...g.version.flows.entries()].filter(([, fs]) => fs.tree === "embedContent" && fs.holderId !== gBody);
    const pasted = flowPieces(bodies[0]?.[1]);
    expect(pasted.length).toBeGreaterThan(1);
    for (const p of pasted) expect(pieceStructCount(p)).toBeLessThanOrEqual(PIECE_SOFT_MAX);
  });
});

// ---------------------------------------------------------------------------
// Concurrent proof scripts (r5 v1 / v3, r6 d1) and oracle-minimised cases, ported: two
// peers, no undo. A block object is a TOC here (tables are P2).
// ---------------------------------------------------------------------------

describe("proof scripts: r5 v1 (non-table)", () => {
  it("#11 (Q5) join ∥ split puts the attrs on the wrong paragraph", () => {
    const [a, b] = pair("x\nyz");
    a.caret(0, 0);
    a.run(setParagraphAttrs, { type: "heading" });
    a.caret(1, 0);
    a.run(setParagraphAttrs, { type: "title" });
    sync(a, b);
    a.caret(1, 0);
    a.run(deleteBackward);
    b.caret(1, 1);
    b.run(splitParagraph);
    sync(a, b);
    // A's join writes x's heading onto z's ¶; B's new ¶ (a copy of y's title) now ends xy.
    expect(a.dump()).toEqual(["title:xy", "heading:z"]);
    expect(b.dump()).toEqual(a.dump());
  });
});

describe("proof scripts: r5 v3", () => {
  it("B9: a block object inserted at the same k by both peers reads as the sequential result", () => {
    const [a, b] = pair("x1x2");
    for (const h of [a, b]) {
      h.caret(0, 2);
      h.run(insertTableOfContents);
    }
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:x1", "toc", "paragraph:", "toc", "paragraph:x2"]);
    expect(b.dump()).toEqual(a.dump());
  });
});

describe("proof scripts: r6 d1 (a TOC as the block object)", () => {
  /** x¶(heading) y¶ on two peers. */
  function seed(ids: [number, number] = [1, 2]): [Harness, Harness] {
    const [a, b] = pair("x\ny", ids);
    a.caret(0, 0);
    a.run(setParagraphAttrs, { type: "heading" });
    sync(a, b);
    a.caret(1, 0);
    b.caret(1, 0);
    return [a, b];
  }

  it("#1 join ∥ an inline image at the start of y → one ordinary paragraph", () => {
    const [a, b] = seed();
    a.run(deleteBackward);
    b.run(insertObject, "image", { props: { src: "a.png" } });
    sync(a, b);
    expect(a.dump()).toEqual(["heading:x[img]y"]);
    expect(b.dump()).toEqual(a.dump());
  });

  it("#2 (Q2) join ∥ a block object at the start of y → x is debris (default style)", () => {
    const [a, b] = seed();
    a.run(deleteBackward);
    b.run(insertTableOfContents);
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:x", "toc", "heading:y"]);
    expect(b.dump()).toEqual(a.dump());
  });

  it("#3 (Q3, B8) [T] ¶a y¶: delete the empty ¶a ∥ insert U at the start of y → [T][U] y¶", () => {
    const [a, b] = pair("");
    a.run(insertTableOfContents);
    a.caret(1, 0);
    a.run(splitParagraph);
    a.run(insertText, "y");
    sync(a, b);
    expect(a.dump()).toEqual(["toc", "paragraph:", "paragraph:y"]);
    a.caret(1, 0);
    a.run(deleteForward);
    b.caret(2, 0);
    b.run(insertTableOfContents);
    sync(a, b);
    expect(a.dump()).toEqual(["toc", "paragraph:", "toc", "paragraph:y"]);
    expect(b.dump()).toEqual(a.dump());
  });

  it("#4 delete an inline image ∥ set its wrap → deleted", () => {
    const [a, b] = pair("ab");
    a.caret(0, 1);
    a.run(insertObject, "image", { props: { src: "a.png" } });
    sync(a, b);
    a.caret(0, 2);
    a.run(deleteBackward);
    b.run(setObjectProps, b.at(0, 1), { wrap: "right" });
    sync(a, b);
    expect(a.dump()).toEqual(["paragraph:ab"]);
    expect(b.dump()).toEqual(a.dump());
  });

  it("#5 (B11) typing at the start of the final paragraph after a block object ∥ a block object there: the final ¶ stays last, both client orders", () => {
    for (const ids of [[1, 2], [2, 1]] satisfies [number, number][]) {
      const [a, b] = pair("", ids);
      a.run(insertTableOfContents);
      sync(a, b);
      a.caret(1, 0);
      a.run(insertText, "A");
      b.caret(1, 0);
      b.run(insertTableOfContents);
      sync(a, b);
      expect(a.dump()).toEqual(ids[0] === 1 ? ["toc", "paragraph:A", "toc", "paragraph:"] : ["toc", "paragraph:", "toc", "paragraph:A"]);
      expect(b.dump()).toEqual(a.dump());
    }
  });
});

describe("oracle minimized cases", () => {
  // K7 (oracle seeds 1 / 25 / 91): a join deleting the ¶ before a paragraph while the same peer
  // pastes [S] at its start (k = 0, right after that ¶) ∥ a peer's C15 there. Q-adj, accepted
  // 2026-11-02: the converged state has adjacent structure the read rules read validly.
  it("join + paste of [S] at a paragraph start ∥ C15 at that paragraph converge, both client orders", () => {
    for (const ids of [[1, 2], [2, 1]] satisfies [number, number][]) {
      const [a, b] = pair("x\n\n", ids);
      a.caret(1, 0);
      a.run(deleteForward);
      a.caret(1, 0);
      a.run(paste, [{ k: "S" }, { k: "para" }]);
      b.caret(1, 0);
      b.run(insertSectionBreak);
      sync(a, b);
      const fs = a.version.flows.get(a.version.rootId);
      expect(fs?.segments.flatMap((s) => s.tokens.map((t) => t.k)).join(" ")).toBe("run para para S S para para");
      expect(a.dump()).toEqual(["paragraph:x", "paragraph:", "|", "|", "paragraph:", "paragraph:"]);
      expect(b.dump()).toEqual(a.dump());
    }
  });
});

describe("tables as marks (N1)", () => {
  /** A harness whose body holds `spec` before its final ¶, and the inserted maps. */
  const withTable = (spec: string): { h: Harness; m: Y.Map<unknown>[] } => {
    const h = new Harness();
    const us = units(spec);
    h.f.doc.transact(() => insertUnits(h.f.piece, 0, us));
    h.history.clear();
    return { h, m: mapsOf(us) };
  };
  const id = (m: Y.Map<unknown> | undefined): string => (m === undefined ? "" : idOf(m));

  it("a caret in a cell is in the cell: a paste holding an [S] is refused there (no [S] inside a table)", () => {
    const { h, m } = withTable("x¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ y¶");
    h.selection = caretAt(id(m[4]), 1);
    const before = h.dump();
    expect(h.run(paste, [{ k: "text", text: "p" }, { k: "S" }, { k: "text", text: "q" }])).toBe(false);
    expect(h.dump()).toEqual(before);
  });

  it("restored marks of a deleted nested table (inert) do not split their cell's paragraphs: Delete at the end of `a` joins `x`", () => {
    const { h, m } = withTable("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩@1 ⟨c⟩@1 x¶ ⟧@1 ⟨c⟩ b¶ ⟧");
    h.selection = caretAt(id(m[3]), 1);
    expect(h.run(deleteForward)).toBe(true);
    const cell = h.version.trees.block.get(id(m[2]));
    const first = cell?.firstChildId ?? "";
    expect(h.version.trees.block.get(first)?.inlineContent?.items).toMatchObject([{ text: "ax" }]);
  });

  it("C10 of a nested table takes its whole bracket; an inert shallower ⟦ inside it does not end it", () => {
    const { h, m } = withTable("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 a¶ ⟦@0 b¶ ⟧@1 c¶ ⟧");
    expect(h.run(deleteBlockObject, id(m[3]))).toBe(true);
    expect(h.f.piece.toString()).toBe("c");
  });
});

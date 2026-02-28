import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import {
  createSelection,
  createCursor,
  isCollapsed,
  selectionStart,
  selectionEnd,
} from "./selection";
import { moveByCharacter, moveByWord, expandSelection, selectWord } from "./cursor-ops";

function makeDoc() {
  const t1 = createTextNode("t1", "Hello ");
  const t2 = createTextNode("t2", "world");
  const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
  return createNode("doc", "document", {}, [p1]);
}

function makeTwoParagraphDoc() {
  const t1 = createTextNode("t1", "First");
  const t2 = createTextNode("t2", "Second");
  const p1 = createNode("p1", "paragraph", {}, [t1]);
  const p2 = createNode("p2", "paragraph", {}, [t2]);
  return createNode("doc", "document", {}, [p1, p2]);
}

describe("Selection model", () => {
  it("creates a collapsed selection (cursor)", () => {
    const sel = createCursor([0, 0], 3);
    expect(isCollapsed(sel)).toBe(true);
    expect(sel.anchor.path).toEqual([0, 0]);
    expect(sel.anchor.offset).toBe(3);
  });

  it("creates an expanded selection", () => {
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 1], 3),
    );
    expect(isCollapsed(sel)).toBe(false);
  });

  it("selectionStart returns the earlier position", () => {
    const sel = createSelection(
      createPosition([0, 1], 3),
      createPosition([0, 0], 1),
    );
    const start = selectionStart(sel);
    expect(start.path).toEqual([0, 0]);
    expect(start.offset).toBe(1);
  });

  it("selectionEnd returns the later position", () => {
    const sel = createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 1], 3),
    );
    const end = selectionEnd(sel);
    expect(end.path).toEqual([0, 1]);
    expect(end.offset).toBe(3);
  });

  it("handles cross-depth selections (different path lengths)", () => {
    // e.g. [0, 0] (shallow text) vs [0, 1, 0] (text inside bold)
    const sel = createSelection(
      createPosition([0, 1, 0], 2),
      createPosition([0, 0], 3),
    );
    // [0, 0] comes before [0, 1, 0] in document order
    const start = selectionStart(sel);
    expect(start.path).toEqual([0, 0]);
    const end = selectionEnd(sel);
    expect(end.path).toEqual([0, 1, 0]);
  });
});

describe("moveByCharacter", () => {
  it("moves forward within a text node", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 0], 2);
    const sel = moveByCharacter(doc, pos, "forward");

    expect(isCollapsed(sel)).toBe(true);
    expect(sel.focus.path).toEqual([0, 0]);
    expect(sel.focus.offset).toBe(3);
  });

  it("moves backward within a text node", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 0], 3);
    const sel = moveByCharacter(doc, pos, "backward");

    expect(sel.focus.offset).toBe(2);
  });

  it("moves from end of one text node to start of next", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 0], 6); // end of "Hello "
    const sel = moveByCharacter(doc, pos, "forward");

    expect(sel.focus.path).toEqual([0, 1]);
    expect(sel.focus.offset).toBe(0);
  });

  it("moves from start of one text node to end of previous", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 1], 0); // start of "world"
    const sel = moveByCharacter(doc, pos, "backward");

    expect(sel.focus.path).toEqual([0, 0]);
    expect(sel.focus.offset).toBe(6);
  });

  it("stays at the start of document when moving backward", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 0], 0);
    const sel = moveByCharacter(doc, pos, "backward");

    expect(sel.focus.path).toEqual([0, 0]);
    expect(sel.focus.offset).toBe(0);
  });

  it("stays at the end of document when moving forward", () => {
    const doc = makeDoc();
    const pos = createPosition([0, 1], 5); // end of "world"
    const sel = moveByCharacter(doc, pos, "forward");

    expect(sel.focus.path).toEqual([0, 1]);
    expect(sel.focus.offset).toBe(5);
  });

  it("crosses paragraph boundary forward", () => {
    const doc = makeTwoParagraphDoc();
    const pos = createPosition([0, 0], 5); // end of "First"
    const sel = moveByCharacter(doc, pos, "forward");

    expect(sel.focus.path).toEqual([1, 0]);
    expect(sel.focus.offset).toBe(0);
  });

  it("crosses paragraph boundary backward", () => {
    const doc = makeTwoParagraphDoc();
    const pos = createPosition([1, 0], 0); // start of "Second"
    const sel = moveByCharacter(doc, pos, "backward");

    expect(sel.focus.path).toEqual([0, 0]);
    expect(sel.focus.offset).toBe(5);
  });
});

describe("moveByWord", () => {
  it("moves forward by word", () => {
    const t1 = createTextNode("t1", "hello world foo");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 0);
    const sel = moveByWord(doc, pos, "forward");

    // Should move to end of "hello" at position 5 (word boundary)
    expect(sel.focus.offset).toBe(5);
  });

  it("moves backward by word", () => {
    const t1 = createTextNode("t1", "hello world foo");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 11);
    const sel = moveByWord(doc, pos, "backward");

    // Should move back to start of "world" at position 6
    expect(sel.focus.offset).toBe(6);
  });

  it("moves to end of content when no more words forward", () => {
    const t1 = createTextNode("t1", "hello");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 0);
    const sel = moveByWord(doc, pos, "forward");

    expect(sel.focus.offset).toBe(5);
  });
});

describe("expandSelection", () => {
  it("expands selection forward", () => {
    const doc = makeDoc();
    const sel = createCursor([0, 0], 2);
    const expanded = expandSelection(doc, sel, "forward");

    expect(expanded.anchor.offset).toBe(2);
    expect(expanded.focus.offset).toBe(3);
    expect(isCollapsed(expanded)).toBe(false);
  });

  it("expands selection backward", () => {
    const doc = makeDoc();
    const sel = createCursor([0, 0], 3);
    const expanded = expandSelection(doc, sel, "backward");

    expect(expanded.anchor.offset).toBe(3);
    expect(expanded.focus.offset).toBe(2);
  });

  it("keeps anchor fixed when expanding", () => {
    const doc = makeDoc();
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 4),
    );
    const expanded = expandSelection(doc, sel, "forward");

    expect(expanded.anchor.offset).toBe(2);
    expect(expanded.focus.offset).toBe(5);
  });
});

describe("selectWord", () => {
  it("selects the word under the cursor", () => {
    const t1 = createTextNode("t1", "hello world foo");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    // Cursor inside "world" at offset 8
    const pos = createPosition([0, 0], 8);
    const sel = selectWord(doc, pos);

    expect(sel.anchor.path).toEqual([0, 0]);
    expect(sel.anchor.offset).toBe(6); // start of "world"
    expect(sel.focus.path).toEqual([0, 0]);
    expect(sel.focus.offset).toBe(11); // end of "world"
  });

  it("selects word when cursor is at word start", () => {
    const t1 = createTextNode("t1", "hello world");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 6); // start of "world"
    const sel = selectWord(doc, pos);

    expect(sel.anchor.offset).toBe(6);
    expect(sel.focus.offset).toBe(11);
  });

  it("selects word when cursor is at word end", () => {
    const t1 = createTextNode("t1", "hello world");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 5); // end of "hello"
    const sel = selectWord(doc, pos);

    expect(sel.anchor.offset).toBe(0);
    expect(sel.focus.offset).toBe(5);
  });

  it("selects single word in text node", () => {
    const t1 = createTextNode("t1", "hello");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 2);
    const sel = selectWord(doc, pos);

    expect(sel.anchor.offset).toBe(0);
    expect(sel.focus.offset).toBe(5);
  });

  it("handles cursor on whitespace between words", () => {
    const t1 = createTextNode("t1", "hello world");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    // On the space at offset 5
    const pos = createPosition([0, 0], 5);
    const sel = selectWord(doc, pos);

    // Should select the nearest word — "hello" (preceding word)
    expect(isCollapsed(sel)).toBe(false);
  });

  it("returns collapsed selection for empty text", () => {
    const t1 = createTextNode("t1", "");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 0);
    const sel = selectWord(doc, pos);

    expect(isCollapsed(sel)).toBe(true);
  });
});

describe("emoji and multi-byte text", () => {
  it("moves forward by one grapheme cluster over an emoji", () => {
    // "Hi👋Z" — the wave emoji is a single grapheme cluster
    const t1 = createTextNode("t1", "Hi\u{1F44B}Z");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    // Position at start of emoji (offset 2)
    const pos = createPosition([0, 0], 2);
    const sel = moveByCharacter(doc, pos, "forward");

    // Should skip the entire emoji (2 UTF-16 code units for surrogate pair)
    expect(sel.focus.offset).toBe(4);
  });

  it("moves backward by one grapheme cluster over an emoji", () => {
    const t1 = createTextNode("t1", "Hi\u{1F44B}Z");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    // Position after emoji (offset 4, before "Z")
    const pos = createPosition([0, 0], 4);
    const sel = moveByCharacter(doc, pos, "backward");

    // Should skip back over the entire emoji
    expect(sel.focus.offset).toBe(2);
  });

  it("handles combining characters as single grapheme", () => {
    // "e\u0301" is é (e + combining acute accent) — one grapheme cluster
    const t1 = createTextNode("t1", "e\u0301X");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc = createNode("doc", "document", {}, [p1]);

    const pos = createPosition([0, 0], 0);
    const sel = moveByCharacter(doc, pos, "forward");

    // Should skip both code points of the combined character
    expect(sel.focus.offset).toBe(2);
  });
});

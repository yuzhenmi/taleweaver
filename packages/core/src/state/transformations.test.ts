import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createPosition, createSpan } from "./position";
import { insertText, deleteRange, replaceRange, splitNode } from "./transformations";

function makeDoc() {
  const t1 = createTextNode("t1", "Hello ");
  const t2 = createTextNode("t2", "world");
  const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
  const doc = createNode("doc", "document", {}, [p1]);
  return { doc, p1, t1, t2 };
}

describe("insertText", () => {
  it("inserts text at the beginning of a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 0);
    const change = insertText(doc, pos, "Oh! ");

    const text = change.newState.children[0].children[0];
    expect(text.properties.content).toBe("Oh! Hello ");
  });

  it("inserts text in the middle of a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 5);
    const change = insertText(doc, pos, ",");

    expect(change.newState.children[0].children[0].properties.content).toBe(
      "Hello, ",
    );
  });

  it("inserts text at the end of a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 1], 5);
    const change = insertText(doc, pos, "!");

    expect(change.newState.children[0].children[1].properties.content).toBe(
      "world!",
    );
  });

  it("preserves old state in the change record", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 0);
    const change = insertText(doc, pos, "X");

    expect(change.oldState).toBe(doc);
    expect(change.newState).not.toBe(doc);
  });

  it("throws when inserting into a non-text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0], 0); // points to paragraph, not text
    expect(() => insertText(doc, pos, "X")).toThrow("not a text node");
  });

  it("throws when offset is negative", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], -1);
    expect(() => insertText(doc, pos, "X")).toThrow("out of bounds");
  });

  it("throws when offset exceeds content length", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 100);
    expect(() => insertText(doc, pos, "X")).toThrow("out of bounds");
  });

  it("uses structural sharing for unchanged nodes", () => {
    const { doc, t2 } = makeDoc();
    const pos = createPosition([0, 0], 0);
    const change = insertText(doc, pos, "X");

    // t2 is unchanged, should share identity
    expect(change.newState.children[0].children[1]).toBe(t2);
  });
});

describe("deleteRange", () => {
  it("deletes within the same text node", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    const change = deleteRange(doc, range);

    expect(change.newState.children[0].children[0].properties.content).toBe(
      " ",
    );
  });

  it("returns same state for empty range", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 3);
    const range = createSpan(pos, pos);
    const change = deleteRange(doc, range);

    expect(change.newState).toBe(doc);
  });

  it("deletes across two text nodes in the same parent (fusion)", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], 4),
      createPosition([0, 1], 3),
    );
    const change = deleteRange(doc, range);

    // "Hell" + "ld" fused into one node, second node removed
    const p = change.newState.children[0];
    expect(p.children).toHaveLength(1);
    expect(p.children[0].properties.content).toBe("Hellld");
  });

  it("throws when offsets are out of bounds", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], -1),
      createPosition([0, 0], 3),
    );
    expect(() => deleteRange(doc, range)).toThrow("out of bounds");
  });

  it("handles reversed range (focus before anchor)", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], 5),
      createPosition([0, 0], 0),
    );
    const change = deleteRange(doc, range);

    expect(change.newState.children[0].children[0].properties.content).toBe(
      " ",
    );
  });

  it("deletes across paragraphs", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([1, 0], 3),
    );
    const change = deleteRange(doc, range);

    // "Fir" + "ond" fused, second paragraph removed
    expect(change.newState.children).toHaveLength(1);
    expect(change.newState.children[0].children[0].properties.content).toBe(
      "Firond",
    );
  });

  it("deletes across paragraphs with multiple text nodes (trims trailing siblings)", () => {
    const t1 = createTextNode("t1", "Hello");
    const t2 = createTextNode("t2", " World");
    const t3 = createTextNode("t3", "Foo");
    const t4 = createTextNode("t4", " Bar");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const p2 = createNode("p2", "paragraph", {}, [t3, t4]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([1, 1], 2),
    );
    const change = deleteRange(doc, range);

    // "Hel" + "ar" fused into t1, t2 removed from p1, p2 removed entirely
    expect(change.newState.children).toHaveLength(1);
    expect(change.newState.children[0].children).toHaveLength(1);
    expect(change.newState.children[0].children[0].properties.content).toBe(
      "Helar",
    );
  });

  it("preserves end paragraph trailing siblings after cross-paragraph delete", () => {
    // p1: [t1:"Hello", t2:" World"]
    // p2: [t3:"Foo", t4:" Bar"]
    // Delete from t1:3 to t3:2 → fuse "Hel"+"o" into t1, keep t4
    const t1 = createTextNode("t1", "Hello");
    const t2 = createTextNode("t2", " World");
    const t3 = createTextNode("t3", "Foo");
    const t4 = createTextNode("t4", " Bar");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const p2 = createNode("p2", "paragraph", {}, [t3, t4]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([1, 0], 2),
    );
    const change = deleteRange(doc, range);

    // Result: one paragraph with "Helo" (fused) + t4:" Bar" preserved
    expect(change.newState.children).toHaveLength(1);
    const p = change.newState.children[0];
    expect(p.children).toHaveLength(2);
    expect(p.children[0].properties.content).toBe("Helo");
    expect(p.children[1].properties.content).toBe(" Bar");
  });

  it("preserves start paragraph leading siblings after cross-paragraph delete", () => {
    // p1: [t1:"Hello", t2:" World"]
    // p2: [t3:"Foo"]
    // Delete from t2:3 to t3:2 → fuse " Wo"+"o" = " Woo", keep t1
    const t1 = createTextNode("t1", "Hello");
    const t2 = createTextNode("t2", " World");
    const t3 = createTextNode("t3", "Foo");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const p2 = createNode("p2", "paragraph", {}, [t3]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const range = createSpan(
      createPosition([0, 1], 3),
      createPosition([1, 0], 2),
    );
    const change = deleteRange(doc, range);

    expect(change.newState.children).toHaveLength(1);
    const p = change.newState.children[0];
    expect(p.children).toHaveLength(2);
    expect(p.children[0].properties.content).toBe("Hello");
    expect(p.children[1].properties.content).toBe(" Woo");
  });

  it("deletes across three paragraphs (removes middle paragraph)", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Middle");
    const t3 = createTextNode("t3", "Last");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const p3 = createNode("p3", "paragraph", {}, [t3]);
    const doc = createNode("doc", "document", {}, [p1, p2, p3]);

    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([2, 0], 2),
    );
    const change = deleteRange(doc, range);

    // "Fir" + "st" fused, p2 and p3 removed
    expect(change.newState.children).toHaveLength(1);
    expect(change.newState.children[0].children[0].properties.content).toBe(
      "First",
    );
  });
});

describe("replaceRange", () => {
  it("replaces text within a single node", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    const change = replaceRange(doc, range, "Goodbye");

    expect(change.newState.children[0].children[0].properties.content).toBe(
      "Goodbye ",
    );
  });

  it("replaces across nodes", () => {
    const { doc } = makeDoc();
    const range = createSpan(
      createPosition([0, 0], 4),
      createPosition([0, 1], 3),
    );
    const change = replaceRange(doc, range, "a w");

    const p = change.newState.children[0];
    expect(p.children).toHaveLength(1);
    expect(p.children[0].properties.content).toBe("Hella wld");
  });

  it("replaces across paragraphs", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([1, 0], 3),
    );
    const change = replaceRange(doc, range, "XYZ");

    expect(change.newState.children).toHaveLength(1);
    expect(change.newState.children[0].children[0].properties.content).toBe(
      "FirXYZond",
    );
  });
});

describe("splitNode", () => {
  it("splits a text node at a position (line break)", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 3);
    const change = splitNode(doc, pos, "p2");

    // Should now have two paragraphs
    expect(change.newState.children).toHaveLength(2);

    const firstPara = change.newState.children[0];
    const secondPara = change.newState.children[1];

    // First paragraph: "Hel" in t1
    expect(firstPara.children).toHaveLength(1);
    expect(firstPara.children[0].properties.content).toBe("Hel");

    // Second paragraph: "lo " in new text, plus t2 ("world")
    expect(secondPara.children).toHaveLength(2);
    expect(secondPara.children[0].properties.content).toBe("lo ");
    expect(secondPara.children[1].properties.content).toBe("world");
  });

  it("splits at the start of a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 0);
    const change = splitNode(doc, pos, "p2");

    expect(change.newState.children).toHaveLength(2);
    expect(change.newState.children[0].children[0].properties.content).toBe("");
    expect(change.newState.children[1].children[0].properties.content).toBe(
      "Hello ",
    );
  });

  it("splits at the end of a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 1], 5);
    const change = splitNode(doc, pos, "p2");

    expect(change.newState.children).toHaveLength(2);
    // First para keeps t1 and t2 (with original content up to split)
    expect(change.newState.children[0].children).toHaveLength(2);
    // Second para has empty text
    expect(change.newState.children[1].children[0].properties.content).toBe("");
  });

  it("preserves the old state in the change", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], 3);
    const change = splitNode(doc, pos, "p2");

    expect(change.oldState).toBe(doc);
  });

  it("splits inside an inline formatting span (depth-aware)", () => {
    // doc > p1 > span({fontWeight:"bold"}) > text:"Hello World"
    // Split at text offset 5, splitDepth=1 (split the paragraph, not the span)
    const text = createTextNode("t1", "Hello World");
    const boldSpan = createNode("b1", "span", { fontWeight: "bold" }, [text]);
    const para = createNode("p1", "paragraph", {}, [boldSpan]);
    const doc = createNode("doc", "document", {}, [para]);

    const pos = createPosition([0, 0, 0], 5);
    const change = splitNode(doc, pos, "new", 0);

    // Should have two paragraphs
    expect(change.newState.children).toHaveLength(2);

    // First paragraph: span > "Hello"
    const p1 = change.newState.children[0];
    expect(p1.children).toHaveLength(1);
    expect(p1.children[0].type).toBe("span");
    expect(p1.children[0].children[0].properties.content).toBe("Hello");

    // Second paragraph: span > " World"
    const p2 = change.newState.children[1];
    expect(p2.children).toHaveLength(1);
    expect(p2.children[0].type).toBe("span");
    expect(p2.children[0].children[0].properties.content).toBe(" World");
  });

  it("splits inside nested inlines preserving siblings", () => {
    // doc > p1 > [text:"A ", span > text:"Hello World", text:" Z"]
    // Split at span>text offset 5, splitDepth=1
    const t1 = createTextNode("t1", "A ");
    const boldText = createTextNode("bt", "Hello World");
    const bold = createNode("b1", "span", { fontWeight: "bold" }, [boldText]);
    const t2 = createTextNode("t2", " Z");
    const para = createNode("p1", "paragraph", {}, [t1, bold, t2]);
    const doc = createNode("doc", "document", {}, [para]);

    const pos = createPosition([0, 1, 0], 5);
    const change = splitNode(doc, pos, "new", 0);

    expect(change.newState.children).toHaveLength(2);

    // First para: [t1:"A ", span>"Hello"]
    const p1 = change.newState.children[0];
    expect(p1.children).toHaveLength(2);
    expect(p1.children[0].properties.content).toBe("A ");
    expect(p1.children[1].type).toBe("span");
    expect(p1.children[1].children[0].properties.content).toBe("Hello");

    // Second para: [span>" World", t2:" Z"]
    const p2 = change.newState.children[1];
    expect(p2.children).toHaveLength(2);
    expect(p2.children[0].type).toBe("span");
    expect(p2.children[0].children[0].properties.content).toBe(" World");
    expect(p2.children[1].properties.content).toBe(" Z");
  });

  it("throws when target is not a text node", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0], 0); // paragraph, not text
    expect(() => splitNode(doc, pos, "new")).toThrow(
      "splitNode target must be a text node",
    );
  });

  it("throws for invalid position path", () => {
    const { doc } = makeDoc();
    const pos = createPosition([99, 0], 0); // invalid path
    expect(() => splitNode(doc, pos, "new")).toThrow("Invalid position path");
  });

  it("throws when offset is out of bounds", () => {
    const { doc } = makeDoc();
    const pos = createPosition([0, 0], -1);
    expect(() => splitNode(doc, pos, "new")).toThrow("out of bounds");
  });
});

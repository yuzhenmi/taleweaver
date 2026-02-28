import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createPosition, createSpan } from "./position";
import { getNodeByPath } from "./operations";
import { getTextContent } from "./text-utils";
import { applyInlineStyle, removeInlineStyle, isFullyStyled, remapPosition } from "./formatting";

function makeDoc(content: string) {
  return createNode("doc", "document", {}, [
    createNode("p0", "paragraph", {}, [createTextNode("t0", content)]),
  ]);
}

describe("applyInlineStyle", () => {
  it("wraps selected text in a span with the style", () => {
    const doc = makeDoc("Hello world");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, span, "fontWeight", "new");
    const result = change.newState;

    // Paragraph should now have: [span[text("Hello")], text(" world")]
    const para = result.children[0];
    expect(para.children.length).toBe(2);

    const styledSpan = para.children[0];
    expect(styledSpan.type).toBe("span");
    expect(styledSpan.properties.fontWeight).toBe("bold");
    expect(getTextContent(styledSpan.children[0])).toBe("Hello");

    expect(getTextContent(para.children[1])).toBe(" world");
  });

  it("splits text node when selection is in the middle", () => {
    const doc = makeDoc("Hello world");
    const span = createSpan(
      createPosition([0, 0], 2),
      createPosition([0, 0], 7),
    );

    const change = applyInlineStyle(doc, span, "fontStyle", "new");
    const result = change.newState;
    const para = result.children[0];

    // Should be: [text("He"), span[text("llo w")], text("orld")]
    expect(para.children.length).toBe(3);
    expect(getTextContent(para.children[0])).toBe("He");

    const styledSpan = para.children[1];
    expect(styledSpan.type).toBe("span");
    expect(styledSpan.properties.fontStyle).toBe("italic");
    expect(getTextContent(styledSpan.children[0])).toBe("llo w");

    expect(getTextContent(para.children[2])).toBe("orld");
  });

  it("does nothing for collapsed span", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 2),
      createPosition([0, 0], 2),
    );

    const change = applyInlineStyle(doc, span, "fontWeight", "new");
    expect(change.newState).toBe(doc);
  });

  it("skips text nodes that already have the style", () => {
    // Document with already-styled content
    const styledText = createNode("st", "text", { content: "Bold", fontWeight: "bold" });
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledText]),
    ]);

    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 4),
    );

    const change = applyInlineStyle(doc, span, "fontWeight", "new");
    // Already styled — no change needed
    expect(change.newState).toBe(doc);
  });
});

describe("removeInlineStyle", () => {
  it("removes style and unwraps span", () => {
    const styledText = createTextNode("t0", "Bold");
    const styledSpan = createNode("s0", "span", { fontWeight: "bold" }, [styledText]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledSpan]),
    ]);

    const span = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 0, 0], 4),
    );

    const change = removeInlineStyle(doc, span, "fontWeight", "new");
    const result = change.newState;
    const para = result.children[0];

    // Span should be unwrapped, leaving just the text node
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("text");
    expect(getTextContent(para.children[0])).toBe("Bold");
  });

  it("keeps span if it has other styles", () => {
    const styledText = createTextNode("t0", "Both");
    const styledSpan = createNode("s0", "span", {
      fontWeight: "bold",
      fontStyle: "italic",
    }, [styledText]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledSpan]),
    ]);

    const span = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 0, 0], 4),
    );

    const change = removeInlineStyle(doc, span, "fontWeight", "new");
    const result = change.newState;
    const para = result.children[0];

    // Span should remain but without fontWeight
    expect(para.children.length).toBe(1);
    const remaining = para.children[0];
    expect(remaining.type).toBe("span");
    expect(remaining.properties.fontWeight).toBeUndefined();
    expect(remaining.properties.fontStyle).toBe("italic");
  });
});

describe("isFullyStyled", () => {
  it("returns false for unstyled text", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    expect(isFullyStyled(doc, span, "fontWeight")).toBe(false);
  });

  it("returns true when all text has the style", () => {
    const styledText = createNode("t0", "text", { content: "Bold", fontWeight: "bold" });
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledText]),
    ]);
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 4),
    );
    expect(isFullyStyled(doc, span, "fontWeight")).toBe(true);
  });

  it("returns false for collapsed selection", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 2),
      createPosition([0, 0], 2),
    );
    expect(isFullyStyled(doc, span, "fontWeight")).toBe(false);
  });

  it("returns true when text is inside a styled span ancestor", () => {
    const text = createNode("t0", "text", { content: "Bold" });
    const styledSpan = createNode("s0", "span", { fontWeight: "bold" }, [text]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledSpan]),
    ]);
    const span = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 0, 0], 4),
    );
    expect(isFullyStyled(doc, span, "fontWeight")).toBe(true);
  });

  it("returns false when only some text has the style", () => {
    const styledText = createNode("t0", "text", { content: "Bold", fontWeight: "bold" });
    const plainText = createNode("t1", "text", { content: " plain" });
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledText, plainText]),
    ]);
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 1], 6),
    );
    expect(isFullyStyled(doc, span, "fontWeight")).toBe(false);
  });
});

// --- Edge cases ---

describe("applyInlineStyle edge cases", () => {
  it("applies style across entire text node", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, span, "fontWeight", "new");
    const result = change.newState;
    const para = result.children[0];

    // Should be: [span[text("Hello")]]
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(getTextContent(para.children[0].children[0])).toBe("Hello");
  });

  it("applies italic style with correct value", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, span, "fontStyle", "new");
    const result = change.newState;
    const para = result.children[0];
    expect(para.children[0].properties.fontStyle).toBe("italic");
  });

  it("applies textDecoration style with correct value", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, span, "textDecoration", "new");
    const result = change.newState;
    const para = result.children[0];
    expect(para.children[0].properties.textDecoration).toBe("underline");
  });

  it("handles multiple text nodes in a paragraph", () => {
    const t0 = createNode("t0", "text", { content: "Hello " });
    const t1 = createNode("t1", "text", { content: "world" });
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [t0, t1]),
    ]);

    // Select across both text nodes
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 1], 5),
    );

    const change = applyInlineStyle(doc, span, "fontWeight", "new");
    const result = change.newState;
    const para = result.children[0];

    // Adjacent bold spans are merged into one
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[0].children.length).toBe(1);
    expect(getTextContent(para.children[0].children[0])).toBe("Hello world");
  });
});

describe("removeInlineStyle edge cases", () => {
  it("does nothing for collapsed span", () => {
    const styledText = createNode("t0", "text", { content: "Bold" });
    const styledSpan = createNode("s0", "span", { fontWeight: "bold" }, [styledText]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledSpan]),
    ]);

    const span = createSpan(
      createPosition([0, 0, 0], 2),
      createPosition([0, 0, 0], 2),
    );

    const change = removeInlineStyle(doc, span, "fontWeight", "new");
    expect(change.newState).toBe(doc);
  });

  it("does nothing when style is not present", () => {
    const doc = makeDoc("Hello");
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = removeInlineStyle(doc, span, "fontWeight", "new");
    expect(change.newState).toBe(doc);
  });
});

describe("removeInlineStyle partial span", () => {
  it("splits span when removing style from middle subset", () => {
    const text = createTextNode("t0", "Hello world");
    const boldSpan = createNode("s0", "span", { fontWeight: "bold" }, [text]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [boldSpan]),
    ]);

    const sel = createSpan(
      createPosition([0, 0, 0], 2),
      createPosition([0, 0, 0], 7),
    );

    const change = removeInlineStyle(doc, sel, "fontWeight", "new");
    const para = change.newState.children[0];

    // Should be: [span({bold})[text("He")], text("llo w"), span({bold})[text("orld")]]
    expect(para.children.length).toBe(3);

    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(getTextContent(para.children[0].children[0])).toBe("He");

    expect(para.children[1].type).toBe("text");
    expect(getTextContent(para.children[1])).toBe("llo w");

    expect(para.children[2].type).toBe("span");
    expect(para.children[2].properties.fontWeight).toBe("bold");
    expect(getTextContent(para.children[2].children[0])).toBe("orld");
  });

  it("splits span when removing style from the beginning", () => {
    const text = createTextNode("t0", "Hello world");
    const boldSpan = createNode("s0", "span", { fontWeight: "bold" }, [text]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [boldSpan]),
    ]);

    const sel = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 0, 0], 5),
    );

    const change = removeInlineStyle(doc, sel, "fontWeight", "new");
    const para = change.newState.children[0];

    // Should be: [text("Hello"), span({bold})[text(" world")]]
    expect(para.children.length).toBe(2);

    expect(para.children[0].type).toBe("text");
    expect(getTextContent(para.children[0])).toBe("Hello");

    expect(para.children[1].type).toBe("span");
    expect(para.children[1].properties.fontWeight).toBe("bold");
    expect(getTextContent(para.children[1].children[0])).toBe(" world");
  });

  it("splits span when removing style from the end", () => {
    const text = createTextNode("t0", "Hello world");
    const boldSpan = createNode("s0", "span", { fontWeight: "bold" }, [text]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [boldSpan]),
    ]);

    const sel = createSpan(
      createPosition([0, 0, 0], 5),
      createPosition([0, 0, 0], 11),
    );

    const change = removeInlineStyle(doc, sel, "fontWeight", "new");
    const para = change.newState.children[0];

    // Should be: [span({bold})[text("Hello")], text(" world")]
    expect(para.children.length).toBe(2);

    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(getTextContent(para.children[0].children[0])).toBe("Hello");

    expect(para.children[1].type).toBe("text");
    expect(getTextContent(para.children[1])).toBe(" world");
  });

  it("preserves other styles when partially removing one style", () => {
    const text = createTextNode("t0", "Hello world");
    const styledSpan = createNode("s0", "span", {
      fontWeight: "bold",
      fontStyle: "italic",
    }, [text]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [styledSpan]),
    ]);

    const sel = createSpan(
      createPosition([0, 0, 0], 2),
      createPosition([0, 0, 0], 7),
    );

    const change = removeInlineStyle(doc, sel, "fontWeight", "new");
    const para = change.newState.children[0];

    // Should be: [span({bold,italic})[text("He")], span({italic})[text("llo w")], span({bold,italic})[text("orld")]]
    expect(para.children.length).toBe(3);

    // Before: bold+italic
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[0].properties.fontStyle).toBe("italic");
    expect(getTextContent(para.children[0].children[0])).toBe("He");

    // Middle: just italic (bold removed)
    expect(para.children[1].type).toBe("span");
    expect(para.children[1].properties.fontWeight).toBeUndefined();
    expect(para.children[1].properties.fontStyle).toBe("italic");
    expect(getTextContent(para.children[1].children[0])).toBe("llo w");

    // After: bold+italic
    expect(para.children[2].type).toBe("span");
    expect(para.children[2].properties.fontWeight).toBe("bold");
    expect(para.children[2].properties.fontStyle).toBe("italic");
    expect(getTextContent(para.children[2].children[0])).toBe("orld");
  });
});

describe("normalizeChildren (via applyInlineStyle / removeInlineStyle)", () => {
  it("merges adjacent bold spans after re-bolding unbolded subset", () => {
    // Start: "Hello" → bold all → unbold "ell" → bold "ell" again
    const doc = makeDoc("Hello");
    const fullSpan = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    // Step 1: Bold "Hello"
    const afterBold = applyInlineStyle(doc, fullSpan, "fontWeight", "b1");

    // Step 2: Unbold "ell" (positions are now inside the bold span)
    const unboldSpan = createSpan(
      createPosition([0, 0, 0], 1),
      createPosition([0, 0, 0], 4),
    );
    const afterUnbold = removeInlineStyle(
      afterBold.newState, unboldSpan, "fontWeight", "u1",
    );

    // Step 3: Re-bold "ell" — need positions in current tree
    // After unbold: para > [span({bold})[text("H")], text("ell"), span({bold})[text("o")]]
    const reBoldSpan = createSpan(
      createPosition([0, 1], 0),
      createPosition([0, 1], 3),
    );
    const afterRebold = applyInlineStyle(
      afterUnbold.newState, reBoldSpan, "fontWeight", "r1",
    );

    // Result should be a single span({bold})[text("Hello")]
    const para = afterRebold.newState.children[0];
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[0].children.length).toBe(1);
    expect(getTextContent(para.children[0].children[0])).toBe("Hello");
  });

  it("merges adjacent text nodes after full unbold", () => {
    // Bold "Hello", then unbold "ell" → [span[text("H")], text("ell"), span[text("o")]]
    // Then unbold "H" and "o" → should merge into single text("Hello")
    const doc = makeDoc("Hello");
    const fullSpan = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    const afterBold = applyInlineStyle(doc, fullSpan, "fontWeight", "b1");

    // Unbold the middle
    const unboldMid = createSpan(
      createPosition([0, 0, 0], 1),
      createPosition([0, 0, 0], 4),
    );
    const afterUnboldMid = removeInlineStyle(
      afterBold.newState, unboldMid, "fontWeight", "u1",
    );

    // Now unbold everything remaining: select full paragraph
    // Tree: [span({bold})[text("H")], text("ell"), span({bold})[text("o")]]
    const unboldAll = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 2, 0], 1),
    );
    const afterUnboldAll = removeInlineStyle(
      afterUnboldMid.newState, unboldAll, "fontWeight", "u2",
    );

    const para = afterUnboldAll.newState.children[0];
    // Should merge into a single text node
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("text");
    expect(getTextContent(para.children[0])).toBe("Hello");
  });

  it("does not merge spans with different properties", () => {
    const boldText = createTextNode("t0", "Bold");
    const boldSpan = createNode("s0", "span", { fontWeight: "bold" }, [boldText]);
    const italicText = createTextNode("t1", "Italic");
    const italicSpan = createNode("s1", "span", { fontStyle: "italic" }, [italicText]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [boldSpan, italicSpan]),
    ]);

    // Apply underline to both — the text nodes get wrapped in textDecoration spans
    // inside their respective parent spans. The outer bold and italic spans have
    // different properties, so they must not merge.
    const sel = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 1, 0], 6),
    );
    const change = applyInlineStyle(doc, sel, "textDecoration", "n1");
    const para = change.newState.children[0];

    expect(para.children.length).toBe(2);
    // Outer spans preserve their original properties
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[1].properties.fontStyle).toBe("italic");
    // Inner textDecoration spans were created
    const inner0 = para.children[0].children[0];
    expect(inner0.type).toBe("span");
    expect(inner0.properties.textDecoration).toBe("underline");
    expect(getTextContent(inner0.children[0])).toBe("Bold");
    const inner1 = para.children[1].children[0];
    expect(inner1.type).toBe("span");
    expect(inner1.properties.textDecoration).toBe("underline");
    expect(getTextContent(inner1.children[0])).toBe("Italic");
  });

  it("preserves all text when bolding three or more sibling text nodes", () => {
    const t0 = createNode("t0", "text", { content: "A" });
    const t1 = createNode("t1", "text", { content: "B" });
    const t2 = createNode("t2", "text", { content: "C" });
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [t0, t1, t2]),
    ]);

    const sel = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 2], 1),
    );
    const change = applyInlineStyle(doc, sel, "fontWeight", "new");
    const para = change.newState.children[0];

    // All three should merge into a single bold span with concatenated text
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[0].children.length).toBe(1);
    expect(getTextContent(para.children[0].children[0])).toBe("ABC");
  });

  it("merges spans and concatenates their inner text nodes", () => {
    // Manually construct: para > [span({bold})[text("H")], span({bold})[text("ello")]]
    const span1 = createNode("s0", "span", { fontWeight: "bold" }, [
      createTextNode("t0", "H"),
    ]);
    const span2 = createNode("s1", "span", { fontWeight: "bold" }, [
      createTextNode("t1", "ello"),
    ]);
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [span1, span2]),
    ]);

    // Apply bold to the whole thing (already bold, so should be no-op structurally,
    // but we need to trigger normalization). Use removeInlineStyle + applyInlineStyle.
    // Instead: just apply italic to first char then remove it, to trigger normalization.
    // Simpler: directly test by applying bold again — text is already inside bold spans
    // so applyInlineStyle won't change. Let's use a different approach:
    // Apply bold to the whole text — since it's already bold, nothing happens.
    // We need to trigger normalization another way.
    // Actually, we should apply a style change that touches the parent and triggers normalize.
    // Let's unbold the "H", then re-bold it. That will trigger normalization on the parent.
    const unboldH = createSpan(
      createPosition([0, 0, 0], 0),
      createPosition([0, 0, 0], 1),
    );
    const afterUnbold = removeInlineStyle(doc, unboldH, "fontWeight", "u1");
    // Now: [text("H"), span({bold})[text("ello")]]

    const reBoldH = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 1),
    );
    const afterRebold = applyInlineStyle(afterUnbold.newState, reBoldH, "fontWeight", "r1");

    // Should merge into single span({bold})[text("Hello")]
    const para = afterRebold.newState.children[0];
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe("span");
    expect(para.children[0].properties.fontWeight).toBe("bold");
    expect(para.children[0].children.length).toBe(1);
    expect(getTextContent(para.children[0].children[0])).toBe("Hello");
  });
});

describe("remapPosition", () => {
  it("remaps position into styled span after applying style", () => {
    const doc = makeDoc("Hello world");
    const sel = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, sel, "fontWeight", "new");
    // New tree: para > [span[text("Hello")], text(" world")]

    // Old position [0,0]:3 → flat offset 3 → inside span>text("Hello") at offset 3
    const remapped = remapPosition(doc, change.newState, createPosition([0, 0], 3));
    expect(remapped.path).toEqual([0, 0, 0]);
    expect(remapped.offset).toBe(3);
  });

  it("remaps position in unstyled part after style application", () => {
    const doc = makeDoc("Hello world");
    const sel = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, sel, "fontWeight", "new");
    // New tree: para > [span[text("Hello")], text(" world")]

    // Old position [0,0]:8 → flat offset 8 → text(" world") at offset 3
    const remapped = remapPosition(doc, change.newState, createPosition([0, 0], 8));
    expect(remapped.path).toEqual([0, 1]);
    expect(remapped.offset).toBe(3);
  });

  it("remaps position at style boundary", () => {
    const doc = makeDoc("Hello world");
    const sel = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, sel, "fontWeight", "new");
    // New tree: para > [span[text("Hello")], text(" world")]

    // Old position [0,0]:5 → flat offset 5 → end of span>text("Hello")
    const remapped = remapPosition(doc, change.newState, createPosition([0, 0], 5));
    expect(remapped.path).toEqual([0, 0, 0]);
    expect(remapped.offset).toBe(5);
  });

  it("preserves position in unaffected paragraph", () => {
    const doc = createNode("doc", "document", {}, [
      createNode("p0", "paragraph", {}, [createTextNode("t0", "Hello world")]),
      createNode("p1", "paragraph", {}, [createTextNode("t1", "Second line")]),
    ]);

    const sel = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );

    const change = applyInlineStyle(doc, sel, "fontWeight", "new");

    // Position in second paragraph should be unchanged
    const remapped = remapPosition(doc, change.newState, createPosition([1, 0], 3));
    expect(remapped.path).toEqual([1, 0]);
    expect(remapped.offset).toBe(3);
  });

  it("remaps position after middle-of-text style application", () => {
    const doc = makeDoc("Hello world");
    const sel = createSpan(
      createPosition([0, 0], 2),
      createPosition([0, 0], 7),
    );

    const change = applyInlineStyle(doc, sel, "fontWeight", "new");
    // New tree: para > [text("He"), span[text("llo w")], text("orld")]

    // Old position [0,0]:9 → flat offset 9 → text("orld") at offset 2
    const remapped = remapPosition(doc, change.newState, createPosition([0, 0], 9));
    expect(remapped.path).toEqual([0, 2]);
    expect(remapped.offset).toBe(2);
  });
});

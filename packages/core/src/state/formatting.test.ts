import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createPosition, createSpan } from "./position";
import { getNodeByPath } from "./operations";
import { getTextContent } from "./text-utils";
import { applyInlineStyle, removeInlineStyle, isFullyStyled } from "./formatting";

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

    // Both text nodes should be wrapped in spans
    expect(para.children.length).toBe(2);
    expect(para.children[0].type).toBe("span");
    expect(para.children[1].type).toBe("span");
    expect(getTextContent(para.children[0].children[0])).toBe("Hello ");
    expect(getTextContent(para.children[1].children[0])).toBe("world");
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

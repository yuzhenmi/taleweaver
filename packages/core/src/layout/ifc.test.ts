import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { createMockMeasurer } from "./text-measurer";
import { layoutInlineContent } from "./ifc";
import { layoutBlock } from "./bfc";
import { createFloatContext } from "./float-context";

const measurer = createMockMeasurer(8, 16);

function ifcOf(text: string, width: number) {
  const tree = cascadePass(
    createElementBox("p", { display: "block" }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("?");
  return layoutInlineContent(tree, 0, 0, width, measurer);
}

describe("layoutInlineContent — single line", () => {
  it("single short text fits on one line", () => {
    const lines = ifcOf("hello world", 200);
    expect(lines).toHaveLength(1);
    if (lines[0].type !== "line") throw new Error("?");
    expect(lines[0].width).toBeGreaterThan(0);
    expect(lines[0].height).toBe(16);
  });
});

describe("layoutInlineContent — wrapping", () => {
  it("wraps when text exceeds available width", () => {
    // mockMeasurer: 8px per char. width 50 fits ~6 chars.
    const lines = ifcOf("hello world", 50);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("each line has y advanced by line height", () => {
    const lines = ifcOf("a b c d e f g h i j", 30);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].y).toBeGreaterThan(lines[i - 1].y);
    }
  });
});

describe("IFC whiteSpace handling", () => {
  it("nowrap produces a single line even when text exceeds width", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "nowrap" }, [
        createTextBox("t", {}, "this is a long line that would normally wrap"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 50, measurer);
    if (out.type !== "block") throw new Error("?");
    // Should produce exactly one line
    const lineBoxes = out.children.filter(c => c.type === "line");
    expect(lineBoxes).toHaveLength(1);
  });

  it("pre breaks at LINE_BREAK and never wraps", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre" }, [
        createTextBox("t", {}, "line one\nline two"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 200, measurer);
    if (out.type !== "block") throw new Error("?");
    const lineBoxes = out.children.filter(c => c.type === "line");
    expect(lineBoxes).toHaveLength(2);
  });

  it("pre-wrap wraps at word boundaries AND breaks at LINE_BREAK", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block", whiteSpace: "pre-wrap" }, [
        createTextBox("t", {}, "long text here\nsecond"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 30, measurer);
    if (out.type !== "block") throw new Error("?");
    const lineBoxes = out.children.filter(c => c.type === "line");
    // Wrap from "long text here" + a hard break + "second" should produce >= 2 lines
    expect(lineBoxes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("IFC — first-class inline boxes", () => {
  it("produces an InlineBox for a display:inline child", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("span", { display: "inline", color: "red" }, [
          createTextBox("t2", {}, "middle"),
        ]),
        createTextBox("t3", {}, " after"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];

    const inlineBox = line.children.find(c => c.type === "inline");
    expect(inlineBox).toBeDefined();
    if (!inlineBox || inlineBox.type !== "inline") throw new Error("?");
    expect(inlineBox.computedStyle.color).toBe("red");
    // For B.2, fragmentEdge is hardcoded "only"; B.3 fixes cross-line resolution.
    expect(inlineBox.fragmentEdge).toBe("only");
  });

  it("inline children content is inside the InlineBox", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("span", { display: "inline" }, [
          createTextBox("t", {}, "hello"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
    const inlineBox = line.children.find(c => c.type === "inline");
    expect(inlineBox).toBeDefined();
    if (!inlineBox || inlineBox.type !== "inline") throw new Error("?");
    // The InlineBox should contain the text run for "hello"
    expect(inlineBox.children.length).toBeGreaterThan(0);
    const textRun = inlineBox.children.find(c => c.type === "text-run");
    expect(textRun).toBeDefined();
    if (!textRun || textRun.type !== "text-run") throw new Error("?");
    expect(textRun.text).toBe("hello");
  });
});

describe("IFC — inline-block atomic placement", () => {
  it("places an inline-block as a single atomic box on the line", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
        createTextBox("t2", {}, " after"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const ib = out.children[0].children.find(c => c.type === "inline-block");
    expect(ib).toBeDefined();
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.width).toBe(50);
    expect(ib.height).toBe(30);
  });

  it("inline-block goes to next line if too wide", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "before "),
        createElementBox("ib", { display: "inline-block", inlineSize: 50, blockSize: 30 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 60, measurer);
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe("IFC — fragmentEdge across lines", () => {
  it("first-line fragment has fragmentEdge='first', last-line has 'last'", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("span", { display: "inline", backgroundColor: "yellow" }, [
          createTextBox("t", {}, "long content that wraps across at least three lines"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 60, measurer);
    if (out.type !== "block") throw new Error("?");
    const lines = out.children.filter(c => c.type === "line");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // First line: inline fragment should be "first"
    if (lines[0].type !== "line") throw new Error("?");
    const firstInline = lines[0].children.find(c => c.type === "inline");
    expect(firstInline?.type).toBe("inline");
    if (firstInline?.type === "inline") {
      expect(firstInline.fragmentEdge).toBe("first");
    }

    // Last line: inline fragment should be "last"
    const lastLine = lines[lines.length - 1];
    if (lastLine.type !== "line") throw new Error("?");
    const lastInline = lastLine.children.find(c => c.type === "inline");
    expect(lastInline?.type).toBe("inline");
    if (lastInline?.type === "inline") {
      expect(lastInline.fragmentEdge).toBe("last");
    }
  });

  it("inline on a single line has fragmentEdge='only'", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t1", {}, "x "),
        createElementBox("span", { display: "inline" }, [
          createTextBox("t2", {}, "y"),
        ]),
        createTextBox("t3", {}, " z"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const inlineBox = out.children[0].children.find(c => c.type === "inline");
    if (inlineBox?.type !== "inline") throw new Error("?");
    expect(inlineBox.fragmentEdge).toBe("only");
  });
});

describe("IFC — verticalAlign", () => {
  it("inline-block with verticalAlign top is at line top", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "x"),
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 50, verticalAlign: "top",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const ib = out.children[0].children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.y).toBe(0);
  });

  it("inline-block with verticalAlign bottom is at line bottom", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "bottom",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    // ib should sit at the bottom of the line
    expect(ib.y).toBe(line.height - ib.height);
  });

  it("inline-block with verticalAlign middle is centered", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("ib", {
          display: "inline-block", inlineSize: 20, blockSize: 30, verticalAlign: "middle",
        }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "line") throw new Error("?");
    const line = out.children[0];
    const ib = line.children.find(c => c.type === "inline-block");
    if (ib?.type !== "inline-block") throw new Error("?");
    expect(ib.y).toBe((line.height - ib.height) / 2);
  });
});

describe("IFC — text wraps around floats", () => {
  it("first lines have reduced width when a left float is active", () => {
    // Set up a float context with one left float.
    const floatCtx = createFloatContext();
    floatCtx.placeFloat({ side: "inline-start", inlineOffset: 0, blockOffset: 0, inlineSize: 100, blockSize: 50 });

    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "this text should wrap to the right of the float on the first lines"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");

    // Call layoutInlineContent directly with the floatCtx
    const cascaded = tree;
    const lines = layoutInlineContent(cascaded, 0, 0, 200, measurer, floatCtx);

    // The first line's content area should start at x=100 (after the float)
    // and have width 100 (200 - 100).
    expect(lines.length).toBeGreaterThan(0);
    if (lines[0].type === "line") {
      expect(lines[0].x).toBe(100);
      expect(lines[0].width).toBe(100);
    }
  });

  it("lines past the float bottom return to full width", () => {
    const floatCtx = createFloatContext();
    floatCtx.placeFloat({ side: "inline-start", inlineOffset: 0, blockOffset: 0, inlineSize: 100, blockSize: 16 });

    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createTextBox("t", {}, "a b c d e f g h i j k l m n o p q r s t"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const lines = layoutInlineContent(tree, 0, 0, 200, measurer, floatCtx);

    // Eventually some line is at y >= 16 and uses full width 200.
    const fullWidthLine = lines.find((l) => l.type === "line" && l.y >= 16 && l.width === 200);
    expect(fullWidthLine).toBeDefined();
  });
});

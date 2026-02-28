/**
 * Integration: inline formatting (span with bold) through the full pipeline.
 *
 * doc > paragraph > [text("Hello "), span({fontWeight:"bold"}) > text("World")]
 * Verifies render tree structure, layout, and cursor movement across
 * the formatting boundary.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, expectTextRender, expectTextBox } from "./setup";

describe("Integration: inline formatting with span", () => {
  it("renders and lays out inline bold text", () => {
    const t1 = createTextNode("t1", "Hello ");
    const spanText = createTextNode("bt", "World");
    const span = createNode("s1", "span", { fontWeight: "bold" }, [spanText]);
    const para = createNode("p1", "paragraph", {}, [t1, span]);
    const doc = createNode("doc", "document", {}, [para]);

    const rendered = renderTree(doc, registry);

    // Verify render tree structure
    expect(rendered.type).toBe("block"); // document
    const rPara = rendered.children[0];
    expect(rPara.type).toBe("block"); // paragraph
    expect(rPara.children).toHaveLength(2);
    expect(rPara.children[0].type).toBe("text");
    expect(expectTextRender(rPara.children[0]).text).toBe("Hello ");
    expect(rPara.children[1].type).toBe("inline"); // span
    expect(rPara.children[1].styles.fontWeight).toBe("bold");
    expect(expectTextRender(rPara.children[1].children[0]).text).toBe("World");

    // Layout
    const layout = layoutTree(rendered, 200, measurer);
    const lPara = layout.children[0];

    // All text should fit on one line
    expect(lPara.children).toHaveLength(1);
    const line = lPara.children[0];

    // "Hello " and "World" should be two word boxes
    expect(line.children).toHaveLength(2);
    expect(expectTextBox(line.children[0]).text).toBe("Hello ");
    expect(expectTextBox(line.children[1]).text).toBe("World");
  });

  it("cursor moves through span boundary", () => {
    const t1 = createTextNode("t1", "Hi ");
    const spanText = createTextNode("bt", "Bold");
    const span = createNode("s1", "span", { fontWeight: "bold" }, [spanText]);
    const para = createNode("p1", "paragraph", {}, [t1, span]);
    const doc = createNode("doc", "document", {}, [para]);

    // Cursor at end of t1 (offset 3 in "Hi ")
    const pos = createPosition([0, 0], 3);
    const sel = moveByCharacter(doc, pos, "forward");

    // Should move to start of span text node at [0, 1, 0], offset 0
    expect(sel.focus.path).toEqual([0, 1, 0]);
    expect(sel.focus.offset).toBe(0);

    // Move backward should go back to t1
    const back = moveByCharacter(doc, sel.focus, "backward");
    expect(back.focus.path).toEqual([0, 0]);
    expect(back.focus.offset).toBe(3);
  });
});

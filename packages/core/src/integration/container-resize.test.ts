/**
 * Integration: re-layout on container width change.
 *
 * A word processor must handle window resizing. The same text should
 * wrap differently at different widths, but the content stays identical.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { registry, measurer } from "./setup";

function setup() {
  // "The quick brown fox" = 19 chars = 152px at 8px/char
  const text = createTextNode("t1", "The quick brown fox");
  const para = createNode("p1", "paragraph", {}, [text]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  return { doc, rendered };
}

/** Collect all text from a layout tree's word boxes. */
function collectText(layout: { children: readonly any[] }): string {
  let text = "";
  for (const child of layout.children) {
    if (child.text != null) {
      text += child.text;
    }
    if (child.children?.length > 0) {
      text += collectText(child);
    }
  }
  return text;
}

describe("Integration: container resize re-layout", () => {
  it("narrow width wraps text to exactly 2 lines", () => {
    const { rendered } = setup();
    const layout = layoutTree(rendered, 80, measurer);

    const para = layout.children[0];
    // 80px = 10 chars. "The quick " (80px) on line 1, "brown fox" (72px) on line 2.
    expect(para.children).toHaveLength(2);
    expect(para.children[0].type).toBe("line");
    expect(para.children[1].type).toBe("line");

    // Lines are stacked vertically
    expect(para.children[0].y).toBe(0);
    expect(para.children[1].y).toBe(19.2);
  });

  it("text content is identical across wide, narrow, and very wide layouts", () => {
    const { rendered } = setup();

    const layoutWide = layoutTree(rendered, 200, measurer);
    const layoutNarrow = layoutTree(rendered, 80, measurer);
    const layoutVeryWide = layoutTree(rendered, 400, measurer);

    // Content is preserved regardless of width
    expect(collectText(layoutWide)).toBe("The quick brown fox");
    expect(collectText(layoutNarrow)).toBe("The quick brown fox");
    expect(collectText(layoutVeryWide)).toBe("The quick brown fox");

    // Wide and very wide: single line
    expect(layoutWide.children[0].children).toHaveLength(1);
    expect(layoutVeryWide.children[0].children).toHaveLength(1);

    // Narrow: multiple lines
    expect(layoutNarrow.children[0].children.length).toBeGreaterThan(1);

    // Geometry differs
    expect(layoutWide.width).toBe(200);
    expect(layoutNarrow.width).toBe(80);
    expect(layoutVeryWide.width).toBe(400);
  });
});

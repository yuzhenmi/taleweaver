/**
 * Integration: re-layout on container width change.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import type { LayoutBox } from "../layout/layout-node";
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
function collectText(layout: LayoutBox): string {
  if (layout.type === "text-run") return layout.text;
  if (layout.type === "marker") return "";
  let text = "";
  for (const child of layout.children) {
    text += collectText(child);
  }
  return text;
}

describe("Integration: container resize re-layout", () => {
  it("narrow width wraps text to exactly 2 lines", () => {
    const { rendered } = setup();
    const layout = layoutTree(rendered, 80, measurer);

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    // 80px = 10 chars. "The quick " (80px) on line 1, "brown fox" (72px) on line 2.
    expect(para.children).toHaveLength(2);
    expect(para.children[0].type).toBe("line");
    expect(para.children[1].type).toBe("line");

    // Lines are stacked vertically
    expect(para.children[0].y).toBe(0);
    expect(para.children[1].y).toBe(16); // line height=16, no margins in Plan 1
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

    if (layoutWide.type !== "block") throw new Error("expected block");
    if (layoutVeryWide.type !== "block") throw new Error("expected block");
    if (layoutNarrow.type !== "block") throw new Error("expected block");

    // Wide and very wide: single line in the paragraph
    const wideParaChildren = layoutWide.children[0].type === "block" ? layoutWide.children[0].children : [];
    const vwParaChildren = layoutVeryWide.children[0].type === "block" ? layoutVeryWide.children[0].children : [];
    const narrowParaChildren = layoutNarrow.children[0].type === "block" ? layoutNarrow.children[0].children : [];
    expect(wideParaChildren).toHaveLength(1);
    expect(vwParaChildren).toHaveLength(1);

    // Narrow: multiple lines
    expect(narrowParaChildren.length).toBeGreaterThan(1);

    // Geometry differs
    expect(layoutWide.width).toBe(200);
    expect(layoutNarrow.width).toBe(80);
    expect(layoutVeryWide.width).toBe(400);
  });
});

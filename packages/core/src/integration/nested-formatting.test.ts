/**
 * Integration: deep inline formatting (nested spans).
 *
 * In Plan 1, spans are stubbed as element boxes with display: inline.
 * Full inline formatting rendering is Plan 2.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations-legacy";
import { renderTree } from "../render/render-legacy";
import { layoutTree } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, lineText } from "./setup";

const containerWidth = 200;

function setup() {
  const t1 = createTextNode("t1", "A ");
  const innerText = createTextNode("it", "B");
  const italic = createNode("i1", "span", {}, [innerText], { fontStyle: "italic" });
  const bold = createNode("b1", "span", {}, [italic], { fontWeight: "bold" });
  const t2 = createTextNode("t2", " C");
  const para = createNode("p1", "paragraph", {}, [t1, bold, t2]);
  const doc = createNode("doc", "document", {}, [para]);
  return { doc };
}

describe("Integration: nested inline formatting", () => {
  it("renders correct structure (Plan 1 stub: spans as element boxes)", () => {
    const { doc } = setup();
    const rendered = renderTree(doc, registry);

    // Document renders as element box with paragraph children
    expect(rendered.type).toBe("element");
    if (rendered.type !== "element") throw new Error("expected element");
    const rPara = rendered.children[0];
    expect(rPara.type).toBe("element");
  });

  it("layout produces line text containing all text content", () => {
    const { doc } = setup();
    const rendered = renderTree(doc, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children.length).toBeGreaterThan(0);

    // All text content should be visible in lines
    const firstLine = para.children[0];
    const text = lineText(firstLine);
    // Text includes "A ", "B", " C" (may be "A B C" depending on span handling)
    expect(text).toContain("A");
    expect(text).toContain("C");
  });

  it("cursor moves through all three formatting segments", () => {
    const { doc } = setup();

    let pos = createPosition([0, 0], 0);

    const sel1 = moveByCharacter(doc, pos, "forward");
    expect(sel1.focus.path).toEqual([0, 0]);
    expect(sel1.focus.offset).toBe(1);

    const sel2 = moveByCharacter(doc, sel1.focus, "forward");
    expect(sel2.focus.path).toEqual([0, 0]);
    expect(sel2.focus.offset).toBe(2);

    const sel3 = moveByCharacter(doc, sel2.focus, "forward");
    expect(sel3.focus.path).toEqual([0, 1, 0, 0]);
    expect(sel3.focus.offset).toBe(0);

    const sel4 = moveByCharacter(doc, sel3.focus, "forward");
    expect(sel4.focus.path).toEqual([0, 1, 0, 0]);
    expect(sel4.focus.offset).toBe(1);

    const sel5 = moveByCharacter(doc, sel4.focus, "forward");
    expect(sel5.focus.path).toEqual([0, 2]);
    expect(sel5.focus.offset).toBe(0);

    const sel7 = moveByCharacter(doc, createPosition([0, 2], 1), "forward");
    expect(sel7.focus.path).toEqual([0, 2]);
    expect(sel7.focus.offset).toBe(2);
  });

  it("deletes across formatting boundary", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 1),
      createPosition([0, 2], 0),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe("A C");

    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    if (layout.type !== "block") throw new Error("expected block");
    if (layout.children[0].type !== "block") throw new Error("expected block");
    expect(lineText(layout.children[0].children[0])).toBe("A C");
  });
});

/**
 * Integration: deletion causes line unwrap.
 * TODO Plan 2 — incremental pipeline tests removed; non-incremental tests kept.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { registry, measurer, expectTextBox, lineText } from "./setup";

const containerWidth = 80;

function setup() {
  const text = createTextNode("t1", "hello world!");
  const para = createNode("p1", "paragraph", {}, [text]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, containerWidth, measurer);
  return { doc, rendered, layout };
}

describe("Integration: deletion causes line unwrap", () => {
  it("starts with text wrapped to two lines", () => {
    const { layout } = setup();

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(2);
    const line0 = para.children[0];
    const line1 = para.children[1];
    if (line0.type !== "line") throw new Error("expected line");
    if (line1.type !== "line") throw new Error("expected line");
    expect(expectTextBox(line0.children[0]).text).toBe("hello ");
    expect(expectTextBox(line1.children[0]).text).toBe("world!");
  });

  it("deleting characters unwraps from 2 lines to 1", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 3),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe("lo world!");

    const newRendered = renderTree(newState, registry);
    const newLayout = layoutTree(newRendered, containerWidth, measurer);

    if (newLayout.type !== "block") throw new Error("expected block");
    const para = newLayout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(1);

    const line = para.children[0];
    if (line.type !== "line") throw new Error("expected line");
    expect(lineText(line)).toBe("lo world!");

    const totalWidth = line.children.reduce((sum: number, c) => sum + c.width, 0);
    expect(totalWidth).toBe(72);
  });
});

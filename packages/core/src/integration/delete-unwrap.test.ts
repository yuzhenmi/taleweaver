/**
 * Integration: deletion causes line unwrap.
 *
 * The inverse of word-wrap.test.ts — deleting text from a wrapped document
 * causes the second line's word to fit back on the first line.
 *
 * Container: 80px wide (10 characters worth of space at 8px/char).
 * Initial text: "hello world!" → "hello " (48px) + "world!" (48px) = 96px → wraps.
 * Delete characters from "hello" so the remaining text fits on one line.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { layoutTree, layoutTreeIncremental } from "../layout/layout-engine";
import { registry, measurer, expectTextBox, lineText } from "./setup";

const containerWidth = 80;

function setup() {
  // "hello world!" = 12 chars = 96px. Container is 80px → wraps.
  // "hello " (48px) on line 1, "world!" (48px) on line 2.
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

    const para = layout.children[0];
    expect(para.children).toHaveLength(2);
    expect(expectTextBox(para.children[0].children[0]).text).toBe("hello ");
    expect(expectTextBox(para.children[1].children[0]).text).toBe("world!");
  });

  it("deleting characters unwraps from 2 lines to 1", () => {
    const { doc, rendered, layout } = setup();

    // Delete "hel" (first 3 chars) → "lo world!" = 9 chars = 72px ≤ 80px → fits!
    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 3),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe(
      "lo world!",
    );

    const newRendered = renderTreeIncremental(
      newState,
      doc,
      rendered,
      registry,
    );
    const newLayout = layoutTreeIncremental(
      newRendered,
      rendered,
      layout,
      containerWidth,
      measurer,
    );

    // Should now be one line
    const para = newLayout.children[0];
    expect(para.children).toHaveLength(1);

    const line = para.children[0];
    expect(lineText(line)).toBe("lo world!");

    // Total width: 9 * 8 = 72px ≤ 80px
    const totalWidth = line.children.reduce((sum, c) => sum + c.width, 0);
    expect(totalWidth).toBe(72);
  });
});

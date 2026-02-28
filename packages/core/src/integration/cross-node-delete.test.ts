/**
 * Integration: delete a selection that spans across two text nodes.
 *
 * Two text nodes in a paragraph: "Hello " + "world".
 * Select "lo wo" (from offset 3 in t1 to offset 2 in t2) and delete.
 * Result: "Helrld" fused into one node, second node removed.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { layoutTree, layoutTreeIncremental } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, expectTextBox } from "./setup";

function setup() {
  const t1 = createTextNode("t1", "Hello ");
  const t2 = createTextNode("t2", "world");
  const para = createNode("p1", "paragraph", {}, [t1, t2]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, 200, measurer);
  return { doc, rendered, layout };
}

describe("Integration: delete a selection across nodes", () => {
  it("deletes across nodes and produces correct layout", () => {
    const { doc, rendered, layout } = setup();

    // Delete from t1 offset 3 to t2 offset 2 → removes "lo wo"
    const range = createSpan(
      createPosition([0, 0], 3),
      createPosition([0, 1], 2),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    // "Hel" + "rld" fused → "Helrld", second node removed
    expect(newState.children[0].children).toHaveLength(1);
    expect(newState.children[0].children[0].properties.content).toBe("Helrld");

    // Render and layout
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
      200,
      measurer,
    );

    // Verify layout shows "Helrld" on one line
    const line = newLayout.children[0].children[0];
    expect(line.children).toHaveLength(1);
    const box = expectTextBox(line.children[0]);
    expect(box.text).toBe("Helrld");
    expect(box.width).toBe(48); // 6 * 8

    // Cursor should be at the deletion point
    const cursorAfterDelete = createPosition([0, 0], 3);
    const sel = moveByCharacter(newState, cursorAfterDelete, "forward");
    expect(sel.focus.offset).toBe(4); // moves to next grapheme
  });
});

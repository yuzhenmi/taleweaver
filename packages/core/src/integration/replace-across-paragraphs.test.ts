/**
 * Integration: replaceRange across two paragraphs.
 *
 * Two paragraphs: "Hello World" and "Goodbye Moon".
 * Select from "Wor" to "Good" (offset 6 in p1/t1 to offset 4 in p2/t2)
 * and replace with "X".
 * Result: single paragraph with "Hello Xbye Moon".
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { replaceRange } from "../state/transformations";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, lineText } from "./setup";

const containerWidth = 200;

function setup() {
  const t1 = createTextNode("t1", "Hello World");
  const t2 = createTextNode("t2", "Goodbye Moon");
  const p1 = createNode("p1", "paragraph", {}, [t1]);
  const p2 = createNode("p2", "paragraph", {}, [t2]);
  const doc = createNode("doc", "document", {}, [p1, p2]);
  return { doc };
}

describe("Integration: replaceRange across paragraphs", () => {
  it("replaces a cross-paragraph selection with new text", () => {
    const { doc } = setup();

    // Select from "World" start (offset 6 in p1/t1) to "Good" end (offset 4 in p2/t2)
    // This deletes "World" + "Good" and replaces with "X"
    const range = createSpan(
      createPosition([0, 0], 6),
      createPosition([1, 0], 4),
    );
    const change = replaceRange(doc, range, "X");
    const newState = change.newState;

    // Should fuse into one paragraph
    expect(newState.children).toHaveLength(1);
    expect(newState.children[0].children[0].properties.content).toBe(
      "Hello Xbye Moon",
    );
  });

  it("produces correct layout after replace", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 6),
      createPosition([1, 0], 4),
    );
    const change = replaceRange(doc, range, "X");

    const rendered = renderTree(change.newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    // Single paragraph, single line
    expect(layout.children).toHaveLength(1);
    const para = layout.children[0];
    expect(para.children).toHaveLength(1);

    expect(lineText(para.children[0])).toBe("Hello Xbye Moon");
  });

  it("cursor navigates through replaced content", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 6),
      createPosition([1, 0], 4),
    );
    const change = replaceRange(doc, range, "X");
    const newState = change.newState;

    // Walk forward from offset 5 ("o" in "Hello") through "X" and beyond
    let pos = createPosition([0, 0], 5);

    const sel1 = moveByCharacter(newState, pos, "forward");
    expect(sel1.focus.offset).toBe(6); // " " → "X"

    const sel2 = moveByCharacter(newState, sel1.focus, "forward");
    expect(sel2.focus.offset).toBe(7); // "X" → "b"

    const sel3 = moveByCharacter(newState, sel2.focus, "forward");
    expect(sel3.focus.offset).toBe(8); // "b" → "y"

    // Walk backward
    const sel4 = moveByCharacter(newState, sel3.focus, "backward");
    expect(sel4.focus.offset).toBe(7);

    const sel5 = moveByCharacter(newState, sel4.focus, "backward");
    expect(sel5.focus.offset).toBe(6);
  });
});

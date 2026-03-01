/**
 * Integration: deep inline formatting (nested spans).
 *
 * State: paragraph > [text("A "), span({fontWeight:"bold"}) > [span({fontStyle:"italic"}) > text("B")], text(" C")]
 * Tests render tree structure, layout flattening, cursor movement across
 * formatting boundaries, and deletion across boundaries.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, expectTextRender, lineText } from "./setup";

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
  it("renders correct nested inline structure", () => {
    const { doc } = setup();
    const rendered = renderTree(doc, registry);

    const rPara = rendered.children[0];
    expect(rPara.type).toBe("block");
    expect(rPara.children).toHaveLength(3);

    // "A " — plain text
    expect(rPara.children[0].type).toBe("text");
    expect(expectTextRender(rPara.children[0]).text).toBe("A ");

    // span({fontWeight:"bold"}) > span({fontStyle:"italic"}) > "B"
    const rBold = rPara.children[1];
    expect(rBold.type).toBe("inline");
    expect(rBold.styles.fontWeight).toBe("bold");
    const rItalic = rBold.children[0];
    expect(rItalic.type).toBe("inline");
    expect(rItalic.styles.fontStyle).toBe("italic");
    expect(rItalic.children[0].type).toBe("text");
    expect(expectTextRender(rItalic.children[0]).text).toBe("B");

    // " C" — plain text
    expect(rPara.children[2].type).toBe("text");
    expect(expectTextRender(rPara.children[2]).text).toBe(" C");
  });

  it("layout flattens nested formatting to word boxes on one line", () => {
    const { doc } = setup();
    const rendered = renderTree(doc, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    const para = layout.children[0];
    expect(para.children).toHaveLength(1); // one line

    const line = para.children[0];
    // Should have word boxes for "A ", "B", " ", "C" (or similar split)
    expect(lineText(line)).toBe("A B C");
  });

  it("cursor moves through all three formatting segments", () => {
    const { doc } = setup();

    // Start in plain text "A " at offset 0
    let pos = createPosition([0, 0], 0);

    // Move through "A "
    const sel1 = moveByCharacter(doc, pos, "forward");
    expect(sel1.focus.path).toEqual([0, 0]);
    expect(sel1.focus.offset).toBe(1); // after "A"

    const sel2 = moveByCharacter(doc, sel1.focus, "forward");
    expect(sel2.focus.path).toEqual([0, 0]);
    expect(sel2.focus.offset).toBe(2); // after " "

    // Cross into span({fontWeight:"bold"}) > span({fontStyle:"italic"}) > text "B"
    const sel3 = moveByCharacter(doc, sel2.focus, "forward");
    expect(sel3.focus.path).toEqual([0, 1, 0, 0]);
    expect(sel3.focus.offset).toBe(0); // start of "B"

    const sel4 = moveByCharacter(doc, sel3.focus, "forward");
    expect(sel4.focus.path).toEqual([0, 1, 0, 0]);
    expect(sel4.focus.offset).toBe(1); // end of "B"

    // Cross into plain text " C"
    const sel5 = moveByCharacter(doc, sel4.focus, "forward");
    expect(sel5.focus.path).toEqual([0, 2]);
    expect(sel5.focus.offset).toBe(0); // start of " C"

    // Move through " C"
    const sel6 = moveByCharacter(doc, sel5.focus, "forward");
    expect(sel6.focus.path).toEqual([0, 2]);
    expect(sel6.focus.offset).toBe(1); // after " "

    const sel7 = moveByCharacter(doc, sel6.focus, "forward");
    expect(sel7.focus.path).toEqual([0, 2]);
    expect(sel7.focus.offset).toBe(2); // after "C" — end of document

    // Now walk backward through all three segments
    const back1 = moveByCharacter(doc, sel7.focus, "backward");
    expect(back1.focus.path).toEqual([0, 2]);
    expect(back1.focus.offset).toBe(1); // before "C"

    const back2 = moveByCharacter(doc, back1.focus, "backward");
    expect(back2.focus.path).toEqual([0, 2]);
    expect(back2.focus.offset).toBe(0); // before " "

    // Cross back into span > span > text "B"
    const back3 = moveByCharacter(doc, back2.focus, "backward");
    expect(back3.focus.path).toEqual([0, 1, 0, 0]);
    expect(back3.focus.offset).toBe(1); // end of "B"

    const back4 = moveByCharacter(doc, back3.focus, "backward");
    expect(back4.focus.path).toEqual([0, 1, 0, 0]);
    expect(back4.focus.offset).toBe(0); // start of "B"

    // Cross back into plain text "A "
    const back5 = moveByCharacter(doc, back4.focus, "backward");
    expect(back5.focus.path).toEqual([0, 0]);
    expect(back5.focus.offset).toBe(2); // end of "A "

    const back6 = moveByCharacter(doc, back5.focus, "backward");
    expect(back6.focus.path).toEqual([0, 0]);
    expect(back6.focus.offset).toBe(1); // after "A"

    const back7 = moveByCharacter(doc, back6.focus, "backward");
    expect(back7.focus.path).toEqual([0, 0]);
    expect(back7.focus.offset).toBe(0); // start of document
  });

  it("deletes across formatting boundary", () => {
    const { doc } = setup();

    // Delete from offset 1 in "A " (after "A") to offset 0 in " C"
    // This removes " " from t1 and "B" from the span nesting
    const range = createSpan(
      createPosition([0, 0], 1),
      createPosition([0, 2], 0),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    // After deletion: t1 has "A C" (fused), span node removed
    expect(newState.children[0].children[0].properties.content).toBe("A C");

    // Render and layout
    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    expect(lineText(layout.children[0].children[0])).toBe("A C");
  });
});

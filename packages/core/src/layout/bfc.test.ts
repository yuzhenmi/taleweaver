import { describe, it, expect } from "vitest";
import { createElementBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { createMockMeasurer } from "./text-measurer";
import { layoutBlock } from "./bfc";

const measurer = createMockMeasurer(8, 16);

function layoutOf(tree: ReturnType<typeof createElementBox>) {
  const cascaded = cascadePass(tree);
  if (cascaded.type !== "element") throw new Error("?");
  return layoutBlock(cascaded, 0, 0, 600, measurer);
}

describe("layoutBlock — basic stacking", () => {
  it("returns block with given width and zero height for empty block", () => {
    const tree = createElementBox("root", { display: "block" }, []);
    const out = layoutOf(tree);
    expect(out.type).toBe("block");
    expect(out.width).toBe(600);
    expect(out.height).toBe(0);
    expect(out.children).toHaveLength(0);
  });

  it("stacks children vertically", () => {
    const child1 = createElementBox("c1", { display: "block", height: 50 }, []);
    const child2 = createElementBox("c2", { display: "block", height: 30 }, []);
    const tree = createElementBox("root", { display: "block" }, [child1, child2]);
    const out = layoutOf(tree);
    expect(out.children).toHaveLength(2);
    if (out.children[0].type !== "block") throw new Error("?");
    if (out.children[1].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(0);
    expect(out.children[0].height).toBe(50);
    expect(out.children[1].y).toBe(50);
    expect(out.children[1].height).toBe(30);
    expect(out.height).toBe(80);
  });

  it("respects padding when laying out children", () => {
    const child = createElementBox("c", { display: "block", height: 40 }, []);
    const tree = createElementBox("root", {
      display: "block",
      paddingTop: 10, paddingBottom: 10, paddingLeft: 5, paddingRight: 5,
    }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(10);   // pushed down by paddingTop
    expect(out.children[0].x).toBe(5);    // pushed right by paddingLeft
    expect(out.children[0].width).toBe(590);  // 600 - paddingLeft - paddingRight
    expect(out.height).toBe(60);  // paddingTop + child + paddingBottom
  });
});

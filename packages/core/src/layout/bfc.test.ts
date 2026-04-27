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

describe("layoutBlock — margin collapse: adjacent siblings", () => {
  it("collapses adjacent sibling margins to max", () => {
    const c1 = createElementBox("c1", {
      display: "block", height: 20, marginBottom: 30,
    }, []);
    const c2 = createElementBox("c2", {
      display: "block", height: 20, marginTop: 10,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [c1, c2]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    if (out.children[1].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(0);
    // c1 ends at 20; gap = max(30, 10) = 30; c2 starts at 50
    expect(out.children[1].y).toBe(50);
  });
});

describe("layoutBlock — margin collapse: parent / first child", () => {
  it("first child marginTop is suppressed when parent has no top padding/border", () => {
    const child = createElementBox("c", {
      display: "block", height: 20, marginTop: 30,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(0);   // marginTop suppressed
    expect(out.height).toBe(20);
  });

  it("first child marginTop is honored when parent has top padding", () => {
    const child = createElementBox("c", {
      display: "block", height: 20, marginTop: 30,
    }, []);
    const tree = createElementBox("root", {
      display: "block", paddingTop: 10,
    }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(40);   // padding + margin
  });
});

describe("layoutBlock — margin collapse: parent / last child", () => {
  it("last child marginBottom is suppressed when parent has no bottom padding/border", () => {
    const child = createElementBox("c", {
      display: "block", height: 20, marginBottom: 30,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    expect(out.height).toBe(20);   // marginBottom suppressed
  });

  it("last child marginBottom is honored when parent has bottom padding", () => {
    const child = createElementBox("c", {
      display: "block", height: 20, marginBottom: 30,
    }, []);
    const tree = createElementBox("root", {
      display: "block", paddingBottom: 5,
    }, [child]);
    const out = layoutOf(tree);
    expect(out.height).toBe(55);   // 20 + 30 + 5
  });
});

describe("layoutBlock — margin collapse: empty block", () => {
  it("empty block margins collapse together", () => {
    const c1 = createElementBox("c1", { display: "block", height: 10 }, []);
    const empty = createElementBox("e", {
      display: "block", marginTop: 20, marginBottom: 30,
    }, []);
    const c2 = createElementBox("c2", { display: "block", height: 10 }, []);
    const tree = createElementBox("root", { display: "block" }, [c1, empty, c2]);
    const out = layoutOf(tree);
    // Expected layout:
    //   c1 at y=0..10 (no margins involved)
    //   empty's combined contribution to gap = max(20, 30) = 30
    //   c2 starts at y = 10 + 30 = 40
    if (out.children[2].type !== "block") throw new Error("?");
    expect(out.children[2].y).toBe(40);
  });
});

describe("layoutBlock — sizing", () => {
  it("auto height = content height including padding", () => {
    const c = createElementBox("c", { display: "block", height: 50 }, []);
    const tree = createElementBox("root", {
      display: "block", paddingTop: 10, paddingBottom: 10,
    }, [c]);
    const out = layoutOf(tree);
    expect(out.height).toBe(70);
  });

  it("explicit width applied", () => {
    const tree = createElementBox("root", { display: "block", width: 200 }, []);
    const out = layoutOf(tree);
    expect(out.width).toBe(200);
  });

  it("auto width fills available", () => {
    const tree = createElementBox("root", { display: "block" }, []);
    const out = layoutOf(tree);
    expect(out.width).toBe(600);
  });
});

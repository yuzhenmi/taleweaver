import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
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
    const child1 = createElementBox("c1", { display: "block", blockSize: 50 }, []);
    const child2 = createElementBox("c2", { display: "block", blockSize: 30 }, []);
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
    const child = createElementBox("c", { display: "block", blockSize: 40 }, []);
    const tree = createElementBox("root", {
      display: "block",
      paddingBlockStart: 10, paddingBlockEnd: 10, paddingInlineStart: 5, paddingInlineEnd: 5,
    }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(10);   // pushed down by paddingBlockStart
    expect(out.children[0].x).toBe(5);    // pushed right by paddingInlineStart
    expect(out.children[0].width).toBe(590);  // 600 - paddingInlineStart - paddingInlineEnd
    expect(out.height).toBe(60);  // paddingBlockStart + child + paddingBlockEnd
  });
});

describe("layoutBlock — margin collapse: adjacent siblings", () => {
  it("collapses adjacent sibling margins to max", () => {
    const c1 = createElementBox("c1", {
      display: "block", blockSize: 20, marginBlockEnd: 30,
    }, []);
    const c2 = createElementBox("c2", {
      display: "block", blockSize: 20, marginBlockStart: 10,
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
  it("first child marginBlockStart is suppressed when parent has no top padding/border", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 20, marginBlockStart: 30,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(0);   // marginBlockStart suppressed
    expect(out.height).toBe(20);
  });

  it("first child marginBlockStart is honored when parent has top padding", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 20, marginBlockStart: 30,
    }, []);
    const tree = createElementBox("root", {
      display: "block", paddingBlockStart: 10,
    }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].y).toBe(40);   // padding + margin
  });
});

describe("layoutBlock — margin collapse: parent / last child", () => {
  it("last child marginBlockEnd is suppressed when parent has no bottom padding/border", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 20, marginBlockEnd: 30,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    expect(out.height).toBe(20);   // marginBlockEnd suppressed
  });

  it("last child marginBlockEnd is honored when parent has bottom padding", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 20, marginBlockEnd: 30,
    }, []);
    const tree = createElementBox("root", {
      display: "block", paddingBlockEnd: 5,
    }, [child]);
    const out = layoutOf(tree);
    expect(out.height).toBe(55);   // 20 + 30 + 5
  });
});

describe("layoutBlock — margin collapse: empty block", () => {
  it("empty block margins collapse together", () => {
    const c1 = createElementBox("c1", { display: "block", blockSize: 10 }, []);
    const empty = createElementBox("e", {
      display: "block", marginBlockStart: 20, marginBlockEnd: 30,
    }, []);
    const c2 = createElementBox("c2", { display: "block", blockSize: 10 }, []);
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
    const c = createElementBox("c", { display: "block", blockSize: 50 }, []);
    const tree = createElementBox("root", {
      display: "block", paddingBlockStart: 10, paddingBlockEnd: 10,
    }, [c]);
    const out = layoutOf(tree);
    expect(out.height).toBe(70);
  });

  it("explicit width applied", () => {
    const tree = createElementBox("root", { display: "block", inlineSize: 200 }, []);
    const out = layoutOf(tree);
    expect(out.width).toBe(200);
  });

  it("auto width fills available", () => {
    const tree = createElementBox("root", { display: "block" }, []);
    const out = layoutOf(tree);
    expect(out.width).toBe(600);
  });
});

describe("layoutBlock — inline content (IFC dispatch)", () => {
  it("a block with text children produces line boxes", () => {
    const tree = createElementBox("p", { display: "block" }, [
      createTextBox("t", {}, "hello world"),
    ]);
    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const out = layoutBlock(cascaded, 0, 0, 200, measurer);
    if (out.type !== "block") throw new Error("?");
    expect(out.children).toHaveLength(1);
    expect(out.children[0].type).toBe("line");
  });
});

describe("BFC — list-item markers (outside)", () => {
  it("decimal markers count up: 1., 2., 3.", () => {
    const tree = cascadePass(
      createElementBox("ol", {
        display: "block", paddingInlineStart: 30, listStyleType: "decimal",
      }, [
        createElementBox("li1", { display: "list-item" }, [createTextBox("t1", {}, "first")]),
        createElementBox("li2", { display: "list-item" }, [createTextBox("t2", {}, "second")]),
        createElementBox("li3", { display: "list-item" }, [createTextBox("t3", {}, "third")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");

    const markers: { text: string }[] = [];
    function walk(b: any) {
      if (!b) return;
      if (b.type === "marker") markers.push({ text: b.text });
      if (b.children) for (const c of b.children) walk(c);
    }
    walk(out);
    expect(markers.map(m => m.text)).toEqual(["1.", "2.", "3."]);
  });

  it("disc markers are bullet glyphs", () => {
    const tree = cascadePass(
      createElementBox("ul", {
        display: "block", paddingInlineStart: 30, listStyleType: "disc",
      }, [
        createElementBox("li1", { display: "list-item" }, [createTextBox("t1", {}, "x")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    let foundMarker: { text: string } | null = null;
    function walk(b: any) {
      if (!b) return;
      if (b.type === "marker") foundMarker = { text: b.text };
      if (b.children) for (const c of b.children) walk(c);
    }
    walk(out);
    expect(foundMarker).toBeTruthy();
    if (foundMarker) expect((foundMarker as { text: string }).text).toBe("•");
  });

  it("nested lists have independent counters", () => {
    const tree = cascadePass(
      createElementBox("ol", { display: "block", paddingInlineStart: 30, listStyleType: "decimal" }, [
        createElementBox("li1", { display: "list-item" }, [
          createTextBox("t1", {}, "outer 1"),
          createElementBox("ol2", { display: "block", paddingInlineStart: 30, listStyleType: "decimal" }, [
            createElementBox("li2a", { display: "list-item" }, [createTextBox("t2a", {}, "inner 1")]),
            createElementBox("li2b", { display: "list-item" }, [createTextBox("t2b", {}, "inner 2")]),
          ]),
        ]),
        createElementBox("li2", { display: "list-item" }, [createTextBox("t2", {}, "outer 2")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    const markers: { text: string }[] = [];
    function walk(b: any) {
      if (!b) return;
      if (b.type === "marker") markers.push({ text: b.text });
      if (b.children) for (const c of b.children) walk(c);
    }
    walk(out);
    // Document order: outer 1 marker, inner 1, inner 2, outer 2
    expect(markers.map(m => m.text)).toEqual(["1.", "1.", "2.", "2."]);
  });
});

describe("BFC — floats", () => {
  it("a left-floated child is placed and BFC encloses it", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("img", { display: "block", float: "inline-start", inlineSize: 100, blockSize: 50 }, []),
        createTextBox("t", {}, "x"),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    // BFC must enclose the float (height >= 50, the float's height).
    expect(out.height).toBeGreaterThanOrEqual(50);
  });

  it("clear: 'inline-start' pushes a block below active floats", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("f", { display: "block", float: "inline-start", inlineSize: 50, blockSize: 100 }, []),
        createElementBox("after", { display: "block", clear: "inline-start", blockSize: 20 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    // The clear:inline-start block should start at y >= 100 (past the float).
    const afterChild = out.children.find((c) => c.type === "block" && c.key === "after");
    expect(afterChild?.type).toBe("block");
    if (afterChild?.type === "block") {
      expect(afterChild.y).toBeGreaterThanOrEqual(100);
    }
  });

  it("a right-floated child is placed at the right edge", () => {
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("img", { display: "block", float: "inline-end", inlineSize: 100, blockSize: 50 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutBlock(tree, 0, 0, 500, measurer);
    if (out.type !== "block") throw new Error("?");
    const float = out.children.find((c) => c.type === "block" && c.key === "img");
    expect(float?.type).toBe("block");
    if (float?.type === "block") {
      // Float at right edge: x = containerWidth - floatWidth = 500 - 100 = 400
      expect(float.x).toBe(400);
    }
  });
});

import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutBlock } from "./bfc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";

const shaper = createMockShaper(8, 16);

function layoutOf(tree: ReturnType<typeof createElementBox>) {
  const cascaded = cascadePass(tree);
  if (cascaded.type !== "element") throw new Error("?");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
  return layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (out.type !== "block") throw new Error("?");
    expect(out.children).toHaveLength(1);
    expect(out.children[0].type).toBe("line");
  });
});

describe("layoutBlock — mixed block + inline children (anonymous box generation)", () => {
  it("produces line(s) for inline-run groups and a block for block children", () => {
    const t1 = createTextBox("t1", { display: "inline" }, "intro");
    const para = createElementBox("p", { display: "block" }, [
      createTextBox("p-text", { display: "inline" }, "paragraph"),
    ]);
    const t2 = createTextBox("t2", { display: "inline" }, "outro");
    const doc = createElementBox("doc", { display: "block" }, [t1, para, t2]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));

    expect(out.type).toBe("block");
    if (out.type !== "block") throw new Error();

    // First child should be a line (from anonymous block run for t1).
    expect(out.children[0].type).toBe("line");

    // There should be a block child for the paragraph.
    expect(out.children.some(c => c.type === "block" && c.key === "p")).toBe(true);

    // After the paragraph, more line(s) for t2 should appear.
    const pIndex = out.children.findIndex(c => c.type === "block" && c.key === "p");
    expect(pIndex).toBeGreaterThan(0);
    const afterP = out.children.slice(pIndex + 1);
    expect(afterP.some(c => c.type === "line")).toBe(true);
  });

  it("a paragraph (all-inline children) still produces line boxes via groupChildren", () => {
    const tree = createElementBox("p", { display: "block" }, [
      createTextBox("t", {}, "hello world"),
    ]);
    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(8, 16));
    if (out.type !== "block") throw new Error("?");
    expect(out.children.length).toBeGreaterThanOrEqual(1);
    expect(out.children[0].type).toBe("line");
  });

  it("a document (all-block children) still stacks blocks vertically", () => {
    const c1 = createElementBox("c1", { display: "block", blockSize: 50 }, []);
    const c2 = createElementBox("c2", { display: "block", blockSize: 30 }, []);
    const doc = createElementBox("doc", { display: "block" }, [c1, c2]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(8, 16));
    if (out.type !== "block") throw new Error("?");
    expect(out.children).toHaveLength(2);
    expect(out.children[0].type).toBe("block");
    expect(out.children[1].type).toBe("block");
    if (out.children[0].type === "block") expect(out.children[0].y).toBe(0);
    if (out.children[1].type === "block") expect(out.children[1].y).toBe(50);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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

// Recursively find the first LayoutBox whose key contains `keyFragment`.
function findBoxByKey(root: import("./layout-box-v2").LayoutBox, keyFragment: string): import("./layout-box-v2").LayoutBox | undefined {
  if (root.key === keyFragment || root.key.includes(keyFragment)) return root;
  if ("children" in root && root.children) {
    for (const c of root.children) {
      const found = findBoxByKey(c, keyFragment);
      if (found) return found;
    }
  }
  return undefined;
}

describe("BFC — intrinsic-sizing keywords on inlineSize", () => {
  it("inlineSize: 'max-content' sizes to maxContent regardless of containing size", () => {
    // "abc" with charWidth=10 → maxContent = 30px; containing = 500px
    const text = createTextBox("t", {}, "abc");
    const block = createElementBox("b", { display: "block", inlineSize: "max-content" }, [text]);
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    const inner = findBoxByKey(out, "b");
    expect(inner).toBeDefined();
    expect(inner?.width).toBe(30);
  });

  it("inlineSize: 'min-content' sizes to minContent", () => {
    // Mock shaper: minContent = minClusterInlineSize = charWidth = 10
    // (smallest single cluster width, representing per-character min).
    const text = createTextBox("t", {}, "abc");
    const block = createElementBox("b", { display: "block", inlineSize: "min-content" }, [text]);
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    const inner = findBoxByKey(out, "b");
    expect(inner).toBeDefined();
    // minContent = max(child.minContent) = minClusterInlineSize = 10 (per mock shaper)
    expect(inner?.width).toBe(10);
  });

  it("inlineSize: 'fit-content' clamps to available space when maxContent fits", () => {
    // "abc" maxContent=30 < available=500 → fit-content = min(30, max(30, 500)) = 30
    const text = createTextBox("t", {}, "abc");
    const block = createElementBox("b", { display: "block", inlineSize: "fit-content" }, [text]);
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    const inner = findBoxByKey(out, "b");
    expect(inner).toBeDefined();
    // maxContent=30 fits within available=500, so fit-content = 30
    expect(inner?.width).toBe(30);
  });

  it("inlineSize: 'fit-content' uses available space when maxContent exceeds it", () => {
    // "abcdefghij" maxContent=100 > available=50 → fit-content = min(100, max(100, 50)) = 100
    // But available is 50, so: min(100, max(100, 50)) = min(100, 100) = 100
    // Actually fit-content when maxContent > available: min(maxContent, max(minContent, available))
    // minContent=100 (one word), max(100, 50)=100, min(100, 100)=100
    // To test clamping, use a two-word text where available < maxContent but > minContent.
    // "ab cd" charWidth=10 → maxContent=50, minContent=20 (longest word "ab"/"cd" = 2chars*10 = 20)
    const text = createTextBox("t", {}, "ab cd");
    const block = createElementBox("b", { display: "block", inlineSize: "fit-content" }, [text]);
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 30);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    const inner = findBoxByKey(out, "b");
    expect(inner).toBeDefined();
    // fit-content = min(maxContent=50, max(minContent=20, available=30)) = min(50, 30) = 30
    expect(inner?.width).toBe(30);
  });
});

describe("BFC — inline-block shrink-to-fit", () => {
  it("inline-block with auto inline-size shrinks to content (max-content)", () => {
    // "abc" with charWidth=10 => max-content = 30px
    const text = createTextBox("t", {}, "abc");
    const ib = createElementBox("ib", { display: "inline-block" }, [text]);
    const para = createElementBox("p", { display: "block" }, [ib]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    expect(out.type).toBe("block");
    if (out.type !== "block") throw new Error();
    // Find the inline-block box in the layout tree
    const ibBox = findBoxByKey(out, "ib");
    expect(ibBox).toBeDefined();
    if (!ibBox) throw new Error();
    // Should shrink-to-fit to "abc" max-content = 30, not fill parent's 500.
    expect(ibBox.width).toBe(30);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
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
    const out = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (out.type !== "block") throw new Error("?");
    const float = out.children.find((c) => c.type === "block" && c.key === "img");
    expect(float?.type).toBe("block");
    if (float?.type === "block") {
      // Float at right edge: x = containerWidth - floatWidth = 500 - 100 = 400
      expect(float.x).toBe(400);
    }
  });
});

describe("BFC — clearance + margin-collapse interaction (CSS 8.3.1)", () => {
  it("clearance prevents marginBlockStart collapse with parent", () => {
    // Setup: parent flow-root with no padding/border. Child has clear: inline-start
    // and a float exists above the child. Without clearance, the child's
    // marginBlockStart would collapse with the (zero) parent margin. With clearance,
    // the marginBlockStart is preserved.
    const float1 = createElementBox(
      "f1",
      { display: "block", float: "inline-start", inlineSize: 100, blockSize: 50 },
      [],
    );
    const cleared = createElementBox(
      "c",
      {
        display: "block",
        clear: "inline-start",
        marginBlockStart: 20,
      },
      [createTextBox("t", { display: "inline" }, "x")],
    );
    const parent = createElementBox(
      "p", { display: "flow-root" }, [float1, cleared],
    );
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));

    // Find cleared child; expect blockOffset = 50 (clearance) + 20 (margin) = 70.
    const clearedBox = findBoxByKey(out, "c");
    expect(clearedBox).toBeDefined();
    if (!clearedBox) throw new Error();
    expect(clearedBox.y).toBe(70);
  });
});

describe("BFC — float rises to nearest BFC", () => {
  it("float inside a non-BFC block is visible to siblings via parent BFC", () => {
    // Layout: flow-root > inner (display:block) > float(100x100)
    //                   > sibling (display:block, text)
    // The float is in 'inner', which is NOT a BFC root. The float rises to the
    // flow-root BFC. The flow-root must enclose the float (height >= 100).
    const float1 = cascadePass(
      createElementBox("f1", { display: "block", float: "inline-start", inlineSize: 100, blockSize: 100 }, []),
    );
    if (float1.type !== "element") throw new Error("?");
    const inner = cascadePass(
      createElementBox("inner", { display: "block" }, [float1]),
    );
    if (inner.type !== "element") throw new Error("?");
    const sibling = cascadePass(
      createElementBox("sibling", { display: "block" }, [
        createTextBox("t", {}, "x"),
      ]),
    );
    if (sibling.type !== "element") throw new Error("?");
    const outer = cascadePass(
      createElementBox("outer", { display: "flow-root" }, [inner, sibling]),
    );
    if (outer.type !== "element") throw new Error("?");

    const out = layoutBlock(outer, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (out.type !== "block") throw new Error("?");

    // The flow-root encloses its floats (the float in inner rises to flow-root BFC).
    expect(out.height).toBeGreaterThanOrEqual(100);
  });

  it("float inside a flow-root does NOT leak to flow-root's parent BFC", () => {
    // Layout: outer (display:block, the root BFC)
    //           > bfc-root (display:flow-root) containing a tall float (300px)
    //           > after (display:block, text)
    // The float is scoped to bfc-root; 'after' should NOT be pushed down by it.
    const tallFloat = cascadePass(
      createElementBox("tf", { display: "block", float: "inline-start", inlineSize: 50, blockSize: 300 }, []),
    );
    if (tallFloat.type !== "element") throw new Error("?");
    const bfcRoot = cascadePass(
      createElementBox("bfc", { display: "flow-root", blockSize: 20 }, [tallFloat]),
    );
    if (bfcRoot.type !== "element") throw new Error("?");
    const after = cascadePass(
      createElementBox("after", { display: "block", blockSize: 20 }, []),
    );
    if (after.type !== "element") throw new Error("?");
    const outer = cascadePass(
      createElementBox("outer", { display: "block" }, [bfcRoot, after]),
    );
    if (outer.type !== "element") throw new Error("?");

    const out = layoutBlock(outer, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (out.type !== "block") throw new Error("?");

    // bfc-root has explicit blockSize:20 (truncates float visually, but encloses it for layout);
    // Actually since bfc-root has explicit blockSize:20, its layout height is 20.
    // 'after' should start at y=20 (right after bfc-root), not y=300 (not leaked by float).
    const afterBox = out.children.find((c) => c.type === "block" && c.key === "after");
    expect(afterBox?.type).toBe("block");
    if (afterBox?.type === "block") {
      expect(afterBox.y).toBe(20);
    }
  });

  it("flow-root block containing only floats encloses them (clearfix)", () => {
    const float1 = createElementBox(
      "f1",
      { display: "block", float: "inline-start", inlineSize: 100, blockSize: 50 },
      [],
    );
    const container = createElementBox("c", { display: "flow-root" }, [float1]);
    const cascaded = cascadePass(container);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
    // The flow-root container should be at least 50px tall (encloses the float).
    expect(out.blockSize).toBeGreaterThanOrEqual(50);
  });
});

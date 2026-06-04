import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { listItemComponent } from "../components/list-item";
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
  const result = layoutBlock(cascaded, 0, 0, ctx, shaper);
  const box = result.box;
  if (box === null) throw new Error("layoutBlock returned null box");
  if (box.type !== "block") throw new Error("layoutBlock returned non-block box");
  return box;
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
    const r = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
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
    const r2 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    const out = r2.box;

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
    const r3 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(8, 16));
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    const out = r3.box;
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
    const r4 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(8, 16));
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    const out = r4.box;
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
    const r5 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out = r5.box;
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
    const r6 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out = r6.box;
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
    const r7 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out = r7.box;
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

describe("BFC — explicit markerText (generated marker, offset-excluded)", () => {
  function collectMarkers(root: import("./layout-box").LayoutBox): import("./layout-box").MarkerBox[] {
    const out: import("./layout-box").MarkerBox[] = [];
    function walk(b: import("./layout-box").LayoutBox) {
      if (b.type === "marker") out.push(b);
      if ("children" in b && b.children) {
        for (const c of b.children) walk(c);
      }
    }
    walk(root);
    return out;
  }

  it("emits a MarkerBox with the explicit text before a plain display:block paragraph", () => {
    // Production leaf shape (#414): the marker-bearing block carries its OWN
    // paddingInlineStart (the marker gutter); there is NO wrapping indent
    // container. markerText "1" is 1ch × 8 = 8px + 4 gap = 12px, comfortably
    // inside the 30px gutter, so the `outside` marker hangs at a positive offset
    // before the content edge (no auto-widen).
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox(
          "para",
          { display: "block", markerText: "1", paddingInlineStart: 30 },
          [createTextBox("t", {}, "body")],
        ),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");

    const markers = collectMarkers(out);
    expect(markers).toHaveLength(1);
    expect(markers[0].text).toBe("1");
    // `outside` (default) — marker hangs to the inline-start of the content edge.
    // contentInlineStart = paddingInlineStart (30). The marker's inline offset
    // must be strictly less than 30 (it sits at/before the content edge).
    expect(markers[0].x).toBeLessThan(30);
    // Marker key follows the `${child.key}-marker` scheme.
    expect(markers[0].key).toBe("para-marker");
  });

  it("emits NO MarkerBox for a plain block without markerText (no regression)", () => {
    const tree = cascadePass(
      createElementBox("root", { display: "block", paddingInlineStart: 30 }, [
        createElementBox("para", { display: "block" }, [createTextBox("t", {}, "body")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    expect(collectMarkers(out)).toHaveLength(0);
  });

  it("display:list-item still emits its auto-counter marker (no regression)", () => {
    const tree = cascadePass(
      createElementBox("ol", { display: "block", paddingInlineStart: 30, listStyleType: "decimal" }, [
        createElementBox("li1", { display: "list-item" }, [createTextBox("t1", {}, "a")]),
        createElementBox("li2", { display: "list-item" }, [createTextBox("t2", {}, "b")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    expect(collectMarkers(out).map(m => m.text)).toEqual(["1.", "2."]);
  });

  it("explicit markerText takes precedence and does NOT advance the list counter when on a list-item", () => {
    // A list-item that ALSO carries an explicit markerText renders the explicit
    // text, and the list counter is NOT incremented for it — the next plain
    // list-item sibling stays at 1.
    const tree = cascadePass(
      createElementBox("ol", { display: "block", paddingInlineStart: 30, listStyleType: "decimal" }, [
        createElementBox("li1", { display: "list-item", markerText: "*" }, [createTextBox("t1", {}, "a")]),
        createElementBox("li2", { display: "list-item" }, [createTextBox("t2", {}, "b")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    // li1 → explicit "*" (counter NOT advanced); li2 → "1." (still first).
    expect(collectMarkers(out).map(m => m.text)).toEqual(["*", "1."]);
  });

  it("offset-exclusion: the marker is a direct sibling of the block, NOT inside its LineBox", () => {
    // Production leaf shape (#414): the marker gutter lives on the para's OWN
    // paddingInlineStart, not a wrapping container.
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox("para", { display: "block", markerText: "1", paddingInlineStart: 30 }, [createTextBox("t", {}, "body")]),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");

    // The block's children are [markerBox, paraBlockBox]; the marker is a
    // sibling of the content block, never nested inside a LineBox.
    const para = out.children.find(c => c.key === "para");
    if (!para || !("children" in para)) throw new Error("para block not found");
    function lineBoxesContainMarker(box: import("./layout-box").LayoutBox): boolean {
      if (box.type === "line") {
        if (!("children" in box)) return false;
        return box.children.some(c => c.type === "marker");
      }
      if ("children" in box && box.children) {
        return box.children.some(lineBoxesContainMarker);
      }
      return false;
    }
    expect(lineBoxesContainMarker(para)).toBe(false);

    // The text run inside the LineBox starts at the same content inline-start
    // (x relative to the para's content box) it would have WITHOUT the marker —
    // proving the marker did not shift the inline flow.
    const treeNoMarker = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox("para", { display: "block", paddingInlineStart: 30 }, [createTextBox("t", {}, "body")]),
      ]),
    );
    if (treeNoMarker.type !== "element") throw new Error("?");
    const r2 = layoutBlock(treeNoMarker, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r2.box;
    if (out2.type !== "block") throw new Error("?");

    function firstTextRunX(box: import("./layout-box").LayoutBox): number | null {
      if (box.type === "text-run") return box.x;
      if ("children" in box && box.children) {
        for (const c of box.children) {
          const x = firstTextRunX(c);
          if (x !== null) return x;
        }
      }
      return null;
    }
    const xWithMarker = firstTextRunX(para);
    const xNoMarker = firstTextRunX(out2);
    expect(xWithMarker).not.toBeNull();
    expect(xWithMarker).toBe(xNoMarker);
  });

  it("auto-widens the indent when an outside marker is wider than paddingInlineStart (#426)", () => {
    // mockShaper: 8px/char advance. An explicit `markerText` of "888." is
    // 4 chars × 8 = 32px wide; with the 4px markerGap the marker gutter needs
    // 36px, but the item's authored paddingInlineStart (the marker gutter) is
    // only 30px. WITHOUT auto-widen the outside marker would hang at
    // `markerContentEdge − markerWidth − markerGap = 30 − 32 − 4 = −6` — left
    // of the item's border edge, off the page. Google Docs instead AUTO-WIDENS
    // the effective paddingInlineStart to `markerWidth + markerGap` (36) so the
    // marker fills the widened gutter (offset 0) and the content shifts right.
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox(
          "wide",
          { display: "block", markerText: "888.", paddingInlineStart: 30 },
          [createTextBox("t", {}, "body")],
        ),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");

    const markers = collectMarkers(out);
    expect(markers).toHaveLength(1);
    const marker = markers[0];
    const markerWidth = marker.inlineSize;
    expect(markerWidth).toBe(32); // "888." × 8px
    const markerGap = 4;

    // The "wide" item is a top-level child of the padding-free root, so its
    // border/margin edge (childInlineStart) is at inline offset 0.
    const childInlineStart = 0;

    // (a) Marker offset is NOT negative — it sits at/after the item border edge.
    expect(marker.inlineOffset).toBeGreaterThanOrEqual(childInlineStart);
    expect(marker.inlineOffset).toBe(0);

    // (b) Marker's inline-end edge + gap does not overlap the content edge.
    const contentLeftEdge = contentEdgeOf(out, "wide");
    expect(marker.inlineOffset + markerWidth + markerGap).toBeLessThanOrEqual(contentLeftEdge);

    // (c) Content shifted right to childInlineStart + (markerWidth + gap).
    expect(contentLeftEdge).toBe(childInlineStart + markerWidth + markerGap);
  });

  it("auto-widens for an INDENTED leaf (childInlineStart > 0) — marker never hangs left of the item border (#426)", () => {
    // The buggy gate gated auto-widen on `childInlineStart + paddingInlineStart`
    // (the absolute content edge) instead of the item's OWN paddingInlineStart.
    // That UNDER-fires for an indented leaf: with marginInlineStart pushing
    // childInlineStart > 0, a marker wider than the item's padding but narrower
    // than `childInlineStart + padding` would NOT widen and would hang LEFT of
    // the item's border edge, overlapping sibling/preceding content.
    //
    // mockShaper: 8px/char. markerText "777." = 4ch × 8 = 32px; + 4 gap = 36px.
    // The leaf carries marginInlineStart 48 (→ childInlineStart = root padding 0
    // + 48 = 48) and its OWN paddingInlineStart 30. 36 is in (30, 78] — wider
    // than the 30 indent but NOT wider than childInlineStart + 30 = 78.
    //   - OLD (buggy) gate: 36 > 78 → false → no widen → marker hangs at
    //     78 − 36 = 42, which is LEFT of childInlineStart (48). RED.
    //   - CORRECT gate:     36 > 30 → true → widen to 36 → marker at
    //     48 + 36 − 36 = 48 = childInlineStart; content edge at 48 + 36 = 84.
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox(
          "indented",
          { display: "block", markerText: "777.", paddingInlineStart: 30, marginInlineStart: 48 },
          [createTextBox("t", {}, "body")],
        ),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");

    const markers = collectMarkers(out);
    expect(markers).toHaveLength(1);
    const marker = markers[0];
    const markerWidth = marker.inlineSize;
    expect(markerWidth).toBe(32); // "777." × 8px
    const markerGap = 4;

    // childInlineStart = root paddingInlineStart (0) + leaf marginInlineStart (48).
    const childInlineStart = 48;

    // (a) Marker sits at/after the item's BORDER edge — NEVER hanging left into
    //     sibling/preceding territory. Under the old buggy gate it landed at 42
    //     (< 48), which this assertion would catch (RED).
    expect(marker.inlineOffset).toBeGreaterThanOrEqual(childInlineStart);
    expect(marker.inlineOffset).toBe(childInlineStart);

    // (b) Content edge shifted right to childInlineStart + (markerWidth + gap).
    //     `contentEdgeOf` returns the first line's inlineOffset, which is the
    //     padding RELATIVE to the indented child's own content box. The marker
    //     offset is expressed in the PARENT's coordinate space, so add the
    //     child's outer offset (its inlineOffset == childInlineStart) to compare
    //     them in the same space.
    const indentedBlock = out.children.find((c) => c.key === "indented");
    if (indentedBlock === undefined) throw new Error("indented block not found");
    const absContentEdge = indentedBlock.inlineOffset + contentEdgeOf(out, "indented");
    expect(absContentEdge).toBe(childInlineStart + markerWidth + markerGap);

    // (c) No marker/content overlap: marker inline-end + gap == content edge.
    expect(marker.inlineOffset + markerWidth + markerGap).toBeLessThanOrEqual(absContentEdge);
  });

  // Inline-start of the first LINE box inside the named block child, RELATIVE
  // to that child block's own origin — i.e. the content edge contributed by the
  // child's (possibly auto-widened) paddingInlineStart. This equals the ABSOLUTE
  // content edge only when the child block itself sits at inlineOffset 0; for an
  // indented child (childInlineStart > 0) the caller adds the child block's own
  // inlineOffset to recover the absolute coordinate.
  function contentEdgeOf(
    root: import("./layout-box").LayoutBox,
    childKey: string,
  ): number {
    if (root.type !== "block") throw new Error("expected block root");
    const child = root.children.find((c) => c.key === childKey);
    if (child === undefined) throw new Error(`child ${childKey} not found`);
    function firstLineInlineOffset(
      box: import("./layout-box").LayoutBox,
    ): number | null {
      if (box.type === "line") return box.inlineOffset;
      if ("children" in box && box.children) {
        for (const c of box.children) {
          const off = firstLineInlineOffset(c);
          if (off !== null) return off;
        }
      }
      return null;
    }
    const lineOffset = firstLineInlineOffset(child);
    if (lineOffset === null) throw new Error("no line box in child");
    return lineOffset;
  }
});

// Recursively find the first LayoutBox whose key contains `keyFragment`.
function findBoxByKey(root: import("./layout-box").LayoutBox, keyFragment: string): import("./layout-box").LayoutBox | undefined {
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
    const r8 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r8.box === null) throw new Error("layoutBlock returned null box");
    const out = r8.box;
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
    const r9 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r9.box === null) throw new Error("layoutBlock returned null box");
    const out = r9.box;
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
    const r10 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r10.box === null) throw new Error("layoutBlock returned null box");
    const out = r10.box;
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
    const r11 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r11.box === null) throw new Error("layoutBlock returned null box");
    const out = r11.box;
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
    const r12 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r12.box === null) throw new Error("layoutBlock returned null box");
    const out = r12.box;
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
    const r13 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r13.box === null) throw new Error("layoutBlock returned null box");
    const out = r13.box;
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
    const r14 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r14.box === null) throw new Error("layoutBlock returned null box");
    const out = r14.box;
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
    const r15 = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r15.box === null) throw new Error("layoutBlock returned null box");
    const out = r15.box;
    if (out.type !== "block") throw new Error("?");
    const float = out.children.find((c) => c.type === "block" && c.key === "img");
    expect(float?.type).toBe("block");
    if (float?.type === "block") {
      // Float at right edge: x = containerWidth - floatWidth = 500 - 100 = 400
      expect(float.x).toBe(400);
    }
  });

  it("L-A: float box has consistent logical AND physical position (no frozen-box invariant violation)", () => {
    // Regression test for the A1 bug: bfc.ts:298 spread-patched x/y onto the
    // float layout without updating inlineOffset/blockOffset, so consumers
    // reading logical fields saw a stale (0, 0) while physical saw the placed
    // coords. We now use withOffsets, so the logical/physical pair must agree.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("f", { display: "block", float: "inline-start", inlineSize: 80, blockSize: 40 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const float = out.children.find((c) => c.type === "block" && c.key === "f");
    if (float?.type !== "block") throw new Error("float not found");
    // First inline-start float at block-start: physical x=0, y=0 (after
    // padding, here zero). Logical offsets must match physical.
    expect(float.inlineOffset).toBe(0);
    expect(float.blockOffset).toBe(0);
    expect(float.x).toBe(0);
    expect(float.y).toBe(0);
    expect(float.inlineSize).toBe(80);
    // The logical/physical invariant — what this test exists to assert —
    // holds regardless of how blockSize was computed.
    expect(float.x).toBe(float.inlineOffset);
    expect(float.y).toBe(float.blockOffset);
  });

  it("L-A: right-float has consistent logical AND physical position", () => {
    // A right-floated 100-wide box in a 500-wide container: physical x = 400.
    // Under LTR horizontal-tb, inlineOffset === x must hold.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("img", { display: "block", float: "inline-end", inlineSize: 100, blockSize: 50 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const float = out.children.find((c) => c.type === "block" && c.key === "img");
    if (float?.type !== "block") throw new Error("float not found");
    expect(float.x).toBe(400);
    expect(float.inlineOffset).toBe(float.x);
    expect(float.y).toBe(float.blockOffset);
  });

  it("L-A: stacked floats — second float's logical/physical position matches", () => {
    // Place a left float, then a second left float in a constrained width so
    // it must stack below. Each must have logical/physical agreement.
    const tree = cascadePass(
      createElementBox("p", { display: "block" }, [
        createElementBox("f1", { display: "block", float: "inline-start", inlineSize: 80, blockSize: 30 }, []),
        createElementBox("f2", { display: "block", float: "inline-start", inlineSize: 80, blockSize: 30 }, []),
      ]),
    );
    if (tree.type !== "element") throw new Error("?");
    // Container narrower than 2*80 — second float must stack below.
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 100), shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    const f1 = out.children.find((c) => c.type === "block" && c.key === "f1");
    const f2 = out.children.find((c) => c.type === "block" && c.key === "f2");
    if (f1?.type !== "block") throw new Error("f1 not found");
    if (f2?.type !== "block") throw new Error("f2 not found");
    expect(f1.inlineOffset).toBe(f1.x);
    expect(f1.blockOffset).toBe(f1.y);
    expect(f2.inlineOffset).toBe(f2.x);
    expect(f2.blockOffset).toBe(f2.y);
    // f2 must be placed below f1 (stacked), so its blockOffset must be > 0.
    expect(f2.blockOffset).toBeGreaterThan(0);
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
    const r16 = layoutBlock(cascaded, 0, 0, ctx, createMockShaper(10, 16));
    if (r16.box === null) throw new Error("layoutBlock returned null box");
    const out = r16.box;

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

    const r17 = layoutBlock(outer, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r17.box === null) throw new Error("layoutBlock returned null box");
    const out = r17.box;
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

    const r18 = layoutBlock(outer, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper);
    if (r18.box === null) throw new Error("layoutBlock returned null box");
    const out = r18.box;
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
    const r19 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r19.box === null) throw new Error("layoutBlock returned null box");
    const out = r19.box;
    // The flow-root container should be at least 50px tall (encloses the float).
    expect(out.blockSize).toBeGreaterThanOrEqual(50);
  });

  // L-F / A7 regression: explicit `inlineSize: 0` MUST produce a
  // zero-width box, not fall back to containing inline size. Pre-fix,
  // `resolveBoxInlineSize`'s `resolved > 0 ? resolved : containingInlineSize`
  // turned 0 into the container's full width (effectively `auto`).
  it("A7: explicit inlineSize: 0 produces a zero-width box", () => {
    const block = createElementBox("zero", { display: "block", inlineSize: 0 }, []);
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    const inner = out.children.find((c) => c.type === "block" && c.key === "zero");
    expect(inner).toBeDefined();
    if (inner?.type === "block") {
      // Pre-fix: this would be 500 (container width). Post-fix: 0.
      expect(inner.width).toBe(0);
    }
  });
});

describe("BFC — in-flow block inline margins (box model)", () => {
  // Per the CSS box model, an in-flow block child X inside parent P is
  // positioned at logical inline offset `P.paddingInlineStart +
  // X.marginInlineStart` with available content width
  // `P.contentInlineSize − X.marginInlineStart − X.marginInlineEnd`. Today
  // these inline margins default to 0 and nothing sets them, so for existing
  // documents this is a no-op; these tests pin the box-model semantics so
  // indent (and any other inline-margin authoring) lands correctly.

  it("marginInlineStart insets the child and reduces its width (block child)", () => {
    // Reference: same block with no inline margin.
    const refChild = createElementBox("c", { display: "block", blockSize: 40 }, []);
    const refTree = createElementBox("root", { display: "block" }, [refChild]);
    const ref = layoutOf(refTree);
    if (ref.children[0].type !== "block") throw new Error("?");
    expect(ref.children[0].inlineOffset).toBe(0);
    expect(ref.children[0].inlineSize).toBe(600);

    const child = createElementBox("c", { display: "block", blockSize: 40, marginInlineStart: 48 }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    // Inset by 48 on the logical inline axis (LTR → x === inlineOffset).
    expect(out.children[0].inlineOffset).toBe(48);
    expect(out.children[0].x).toBe(48);
    // Width reduced by the inline-start margin (no inline-end margin here).
    expect(out.children[0].inlineSize).toBe(600 - 48);
    expect(out.children[0].width).toBe(600 - 48);
  });

  it("marginInlineStart + marginInlineEnd reduce width by their sum", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 40, marginInlineStart: 48, marginInlineEnd: 24,
    }, []);
    const tree = createElementBox("root", { display: "block" }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].inlineOffset).toBe(48);
    expect(out.children[0].inlineSize).toBe(600 - 48 - 24);
    expect(out.children[0].x).toBe(48);
    expect(out.children[0].width).toBe(600 - 48 - 24);
  });

  it("inline margin composes with parent paddingInlineStart", () => {
    const child = createElementBox("c", { display: "block", blockSize: 40, marginInlineStart: 30 }, []);
    const tree = createElementBox("root", {
      display: "block", paddingInlineStart: 10, paddingInlineEnd: 10,
    }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    // paddingInlineStart (10) + marginInlineStart (30) = 40.
    expect(out.children[0].inlineOffset).toBe(40);
    expect(out.children[0].x).toBe(40);
    // contentInlineSize = 600 - 10 - 10 = 580; minus marginInlineStart 30 = 550.
    expect(out.children[0].inlineSize).toBe(580 - 30);
    expect(out.children[0].width).toBe(580 - 30);
  });

  it("explicit-block-size child honors inline margin", () => {
    // An explicit blockSize takes the createBlockBox path (bfc.ts:668),
    // a separate positioning site that must also apply the inline margin.
    const child = createElementBox("c", {
      display: "block", blockSize: 40, inlineSize: 100, marginInlineStart: 48,
    }, []);
    const tree = createElementBox("root", { display: "block", paddingBlockStart: 5 }, [child]);
    const out = layoutOf(tree);
    if (out.children[0].type !== "block") throw new Error("?");
    expect(out.children[0].inlineOffset).toBe(48);
    expect(out.children[0].x).toBe(48);
  });

  it("RTL parent: inline margin insets from the logical start (physical right)", () => {
    // contentInlineSize = 600 (no padding). Child fills, reduced by margin.
    // LTR x === inlineOffset; RTL mirrors: x = contentInlineSize - inlineOffset - inlineSize.
    const child = createElementBox("c", {
      display: "block", blockSize: 40, marginInlineStart: 48, direction: "rtl",
    }, []);
    const tree = createElementBox("root", { display: "block", direction: "rtl" }, [child]);
    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 600);
    const r = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "block") throw new Error("?");
    const c = out.children[0];
    expect(c.inlineOffset).toBe(48);
    expect(c.inlineSize).toBe(600 - 48);
    // Physical x mirrors: 600 - 48 - (600 - 48) = 0. The inline-start margin
    // is on the physical RIGHT in RTL, so the box hugs the physical-left edge.
    expect(c.x).toBe(600 - 48 - (600 - 48));
    expect(c.x).toBe(0);
  });

  it("RTL parent: inline-end margin pushes the box off the physical-left edge", () => {
    const child = createElementBox("c", {
      display: "block", blockSize: 40, marginInlineEnd: 30, direction: "rtl",
    }, []);
    const tree = createElementBox("root", { display: "block", direction: "rtl" }, [child]);
    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext({ ...INITIAL_COMPUTED_STYLE, direction: "rtl" }, 600);
    const r = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    const out = r.box;
    if (out.type !== "block") throw new Error("?");
    if (out.children[0].type !== "block") throw new Error("?");
    const c = out.children[0];
    expect(c.inlineOffset).toBe(0);
    expect(c.inlineSize).toBe(600 - 30);
    // x = 600 - 0 - (600 - 30) = 30 (inline-end margin sits on the physical left).
    expect(c.x).toBe(30);
  });

  it("list-item marker stays glued to indented content under inline margin", () => {
    // Reference: marker offset with no inline margin.
    const refLi = createElementBox("li", { display: "list-item" }, [createTextBox("t", {}, "x")]);
    const refOl = createElementBox("ol", {
      display: "block", paddingInlineStart: 30, listStyleType: "decimal",
    }, [refLi]);
    const refCascaded = cascadePass(refOl);
    if (refCascaded.type !== "element") throw new Error("?");
    const refOut = layoutBlock(refCascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper).box;
    if (refOut === null || refOut.type !== "block") throw new Error("?");
    const refMarker = refOut.children.find((c) => c.type === "marker");
    if (refMarker === undefined) throw new Error("no ref marker");

    // With marginInlineStart on the list-item, BOTH the marker and the
    // content indent by the margin (the whole item shifts).
    const li = createElementBox("li", { display: "list-item", marginInlineStart: 40 }, [createTextBox("t", {}, "x")]);
    const ol = createElementBox("ol", {
      display: "block", paddingInlineStart: 30, listStyleType: "decimal",
    }, [li]);
    const cascaded = cascadePass(ol);
    if (cascaded.type !== "element") throw new Error("?");
    const out = layoutBlock(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper).box;
    if (out === null || out.type !== "block") throw new Error("?");
    const marker = out.children.find((c) => c.type === "marker");
    if (marker === undefined) throw new Error("no marker");
    // Marker shifts by exactly the inline margin relative to the reference.
    expect(marker.inlineOffset).toBe(refMarker.inlineOffset + 40);
    // The list-item content block also shifts by the margin.
    const liBox = out.children.find((c) => c.type === "block" && c.key === "li");
    if (liBox === undefined || liBox.type !== "block") throw new Error("no li box");
    expect(liBox.inlineOffset).toBe(30 + 40);
  });

  it("regression: marginInline 0 (unset) is byte-identical to no-margin layout", () => {
    // Guard the no-op claim: an explicitly-zero inline margin must produce
    // geometry identical to the unset case at every field.
    const a = createElementBox("c", { display: "block", blockSize: 40 }, []);
    const at = createElementBox("root", {
      display: "block", paddingInlineStart: 7, paddingInlineEnd: 11,
    }, [a]);
    const outA = layoutOf(at);

    const b = createElementBox("c", {
      display: "block", blockSize: 40, marginInlineStart: 0, marginInlineEnd: 0,
    }, []);
    const bt = createElementBox("root", {
      display: "block", paddingInlineStart: 7, paddingInlineEnd: 11,
    }, [b]);
    const outB = layoutOf(bt);

    if (outA.children[0].type !== "block" || outB.children[0].type !== "block") throw new Error("?");
    expect(outB.children[0].inlineOffset).toBe(outA.children[0].inlineOffset);
    expect(outB.children[0].blockOffset).toBe(outA.children[0].blockOffset);
    expect(outB.children[0].inlineSize).toBe(outA.children[0].inlineSize);
    expect(outB.children[0].blockSize).toBe(outA.children[0].blockSize);
    expect(outB.children[0].x).toBe(outA.children[0].x);
    expect(outB.children[0].y).toBe(outA.children[0].y);
    expect(outB.children[0].width).toBe(outA.children[0].width);
    expect(outB.children[0].height).toBe(outA.children[0].height);
  });
});

// The word-processor model puts list presentation (listStyleType +
// the structural marker gutter) on the list-item LEAF itself — there is no
// wrapping `list` container in the toggle-list path. These tests drive the
// real `listItemComponent.render` output through cascade+layout so they
// exercise the actual editor codepath, asserting GEOMETRY (marker glyph,
// positive marker offset inside the content column, content indent), not
// just structure.
describe("BFC — list-item leaf carries its own marker presentation (component-driven)", () => {
  function collectMarkers(root: import("./layout-box").LayoutBox): import("./layout-box").MarkerBox[] {
    const out: import("./layout-box").MarkerBox[] = [];
    function walk(b: import("./layout-box").LayoutBox) {
      if (b.type === "marker") out.push(b);
      if ("children" in b && b.children) {
        for (const c of b.children) walk(c);
      }
    }
    walk(root);
    return out;
  }

  // Absolute (root-relative) inline position of the list-item's first content
  // line. All box positions are PARENT-RELATIVE, so we accumulate the li
  // block's own `x` plus the line's `x`. In the leaf model the root container
  // has no padding, so `li.x === 0` and the indent comes entirely from the
  // item's OWN paddingInlineStart, which surfaces as the line's `x` (= 30)
  // inside the li block. Summing the two gives the parent-relative content
  // edge, which matches the marker's frame (the marker is a sibling of the li
  // block under the same root parent).
  function absoluteContentEdge(liBlock: import("./layout-box").LayoutBox): number {
    let lineX: number | null = null;
    function walk(b: import("./layout-box").LayoutBox) {
      if (lineX !== null) return;
      if (b.type === "line") { lineX = b.x; return; }
      if ("children" in b && b.children) for (const c of b.children) walk(c);
    }
    walk(liBlock);
    if (lineX === null) throw new Error("no content line found");
    return liBlock.x + lineX;
  }

  // markerGap is 4 in the BFC; mock shaper advances 8 px per char.
  const MARKER_GAP = 4;
  const CHAR_W = 8;

  function listItemBox(
    key: string,
    listType: "ordered" | "unordered",
    text: string,
    extraAttrs: Record<string, unknown> = {},
  ): ReturnType<typeof createElementBox> {
    const el = listItemComponent.render(
      {
        id: key as unknown as import("../state").BlockId,
        type: "list-item",
        attrs: Object.freeze({ listType, ...extraAttrs }),
        computedStyle: {} as import("../styles").ComputedStyle,
        kind: "leaf",
        inlineContent: { items: [] },
      },
      { state: {} as import("../state").State, footnoteNumber: () => undefined },
      [createTextBox(`${key}-t`, {}, text)],
    );
    if (el.type !== "element") throw new Error("component did not return an element");
    return el;
  }

  function layoutItems(items: ReturnType<typeof createElementBox>[]) {
    const tree = cascadePass(createElementBox("root", { display: "block" }, items));
    if (tree.type !== "element") throw new Error("?");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 600), shaper);
    if (r.box === null || r.box.type !== "block") throw new Error("layout failed");
    return r.box;
  }

  it("ordered list-items emit DECIMAL counter markers (1., 2., 3.) — not bullets — continuing across consecutive items", () => {
    const out = layoutItems([
      listItemBox("li1", "ordered", "first"),
      listItemBox("li2", "ordered", "second"),
      listItemBox("li3", "ordered", "third"),
    ]);
    expect(collectMarkers(out).map(m => m.text)).toEqual(["1.", "2.", "3."]);
  });

  it("ordered marker sits at a POSITIVE inline offset inside the content column, glued to the indented content edge", () => {
    const out = layoutItems([listItemBox("li1", "ordered", "first")]);
    const li1 = out.children.find(c => c.key === "li1");
    if (!li1) throw new Error("li1 block not found");
    const pad = absoluteContentEdge(li1); // content lines start at paddingInlineStart
    expect(pad).toBeGreaterThan(0); // text indented off the page edge

    const markers = collectMarkers(out);
    expect(markers).toHaveLength(1);
    const marker = markers[0];
    // "1." → 2 chars × 8 = 16 px wide.
    const markerWidth = "1.".length * CHAR_W;
    // outside marker: paddingInlineStart - markerWidth - markerGap, and POSITIVE.
    expect(marker.x).toBe(pad - markerWidth - MARKER_GAP);
    expect(marker.x).toBeGreaterThan(0);
  });

  it("unordered list-item emits the bullet '•' at the same positive offset", () => {
    const out = layoutItems([listItemBox("ul1", "unordered", "x")]);
    const ul1 = out.children.find(c => c.key === "ul1");
    if (!ul1) throw new Error("ul1 block not found");
    const pad = absoluteContentEdge(ul1);
    const markers = collectMarkers(out);
    expect(markers.map(m => m.text)).toEqual(["•"]);
    const markerWidth = "•".length * CHAR_W;
    expect(markers[0].x).toBe(pad - markerWidth - MARKER_GAP);
    expect(markers[0].x).toBeGreaterThan(0);
  });

  it("a user marginInlineStart indent ADDS ON TOP OF the base list indent (content + marker shift together)", () => {
    const base = layoutItems([listItemBox("li1", "ordered", "first")]);
    const baseLi = base.children.find(c => c.key === "li1");
    if (!baseLi) throw new Error("baseLi not found");
    const basePad = absoluteContentEdge(baseLi);

    const indented = layoutItems([listItemBox("li1", "ordered", "first", { marginInlineStart: 48 })]);
    const indentedLi = indented.children.find(c => c.key === "li1");
    if (!indentedLi) throw new Error("indentedLi not found");
    const indentedPad = absoluteContentEdge(indentedLi);

    // childInlineStart = paddingInlineStart + marginInlineStart → content moves
    // right by exactly the user indent, on top of the structural base indent.
    expect(indentedPad).toBe(basePad + 48);
    // Marker stays glued to the (now further-indented) content edge.
    const markerWidth = "1.".length * CHAR_W;
    expect(collectMarkers(indented)[0].x).toBe(indentedPad - markerWidth - MARKER_GAP);
  });
});

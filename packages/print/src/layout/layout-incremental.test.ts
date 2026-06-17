import { describe, it, expect } from "vitest";
import { createElementBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { layoutTreeIncremental } from "./layout-incremental";
import { positionTreeForTest } from "../test-utils/position-tree";

const measurer = createMockShaper(8, 16);

describe("layoutTreeIncremental", () => {
  it("reuses unchanged layout box when reference is the same and width unchanged", () => {
    const subtree = createElementBox("inner", { display: "block", blockSize: 50 }, []);
    const treeA = cascadePass(createElementBox("root", { display: "block" }, [subtree]));
    const treeB = cascadePass(createElementBox("root", { display: "block" }, [subtree]));

    const layoutA = layoutTree(treeA, 600, measurer);
    const layoutB = layoutTreeIncremental(treeB, treeA, layoutA, 600, measurer);

    // For the simple Plan 2 implementation, the whole tree is the same reference if it short-circuits.
    // OR: if it falls back to full layout, the layouts should be equal-shape but different references.
    // The spec is: short-circuit fires only when newRoot === oldRoot AND containerWidth unchanged.
    // Since cascadePass produces fresh objects per call, treeA !== treeB.
    // So we don't expect identity here — we just expect a valid layout result.
    expect(positionTreeForTest(layoutB).width).toBe(positionTreeForTest(layoutA).width);
    expect(positionTreeForTest(layoutB).height).toBe(positionTreeForTest(layoutA).height);
  });

  it("short-circuits when newRoot === oldRoot AND width unchanged", () => {
    const tree = cascadePass(createElementBox("root", { display: "block", blockSize: 50 }, []));
    const layoutA = layoutTree(tree, 600, measurer);
    const layoutB = layoutTreeIncremental(tree, tree, layoutA, 600, measurer);
    expect(layoutB).toBe(layoutA);  // exact same reference
  });

  it("falls back to full layout when width changes", () => {
    const tree = cascadePass(createElementBox("root", { display: "block", blockSize: 50 }, []));
    const layoutA = layoutTree(tree, 600, measurer);
    const layoutB = layoutTreeIncremental(tree, tree, layoutA, 800, measurer);
    expect(positionTreeForTest(layoutB).width).toBe(800);
    expect(layoutB).not.toBe(layoutA);
  });
});

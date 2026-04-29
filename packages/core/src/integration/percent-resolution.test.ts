/**
 * Integration: percent-length resolution at layout time.
 *
 * Verifies that a block with a percentage margin produces a usedStyle with
 * the margin resolved to an absolute pixel value relative to the containing
 * inline size.
 */
import { describe, it, expect } from "vitest";
import { createElementBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockMeasurer } from "../layout/text-measurer";

const measurer = createMockMeasurer(8, 16);

describe("Percent length resolution at layout time", () => {
  it("marginInlineStart: 10% of containingInlineSize=500 → 50", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox(
          "p",
          { display: "block", marginInlineStart: { unit: "percent", value: 10 } },
          [],
        ),
      ]),
    );
    const root = layoutTree(tree, 500, measurer);
    expect(root.type).toBe("block");
    if (root.type !== "block") throw new Error("expected block root");
    expect(root.children[0].type).toBe("block");
    if (root.children[0].type !== "block") throw new Error("expected block child");
    expect(root.children[0].usedStyle.marginInlineStart).toBe(50);
  });
});

/**
 * Integration: percent-length resolution at layout time.
 *
 * Verifies that a block with a percentage margin produces a usedStyle with
 * the margin resolved to an absolute pixel value relative to the containing
 * inline size.
 */
import { describe, it, expect } from "vitest";
import { createElementBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";

const measurer = createMockShaper(8, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
    const child = nth(root.children, 0, "block child");
    expect(child.type).toBe("block");
    if (child.type !== "block") throw new Error("expected block child");
    expect(child.usedStyle.marginInlineStart).toBe(50);
  });
});

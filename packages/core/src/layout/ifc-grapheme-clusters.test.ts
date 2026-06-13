import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutInlineContent } from "./ifc";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "./layout-context";
import type { LayoutBox, TextRunBox } from "./layout-box";

const shaper = createMockShaper(8, 16); // 8px per grapheme, 16px line height

/**
 * Lay out a single paragraph with one text child and return its text-run
 * leaves (across all lines). Mirrors the harness in ifc-text-transform.test.ts.
 */
function textRunLeavesOf(text: string, width: number): TextRunBox[] {
  const tree = cascadePass(
    createElementBox("p", { display: "block" }, [createTextBox("t", {}, text)]),
  );
  if (tree.type !== "element") throw new Error("expected element tree");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");

  const leaves: TextRunBox[] = [];
  const walk = (box: LayoutBox): void => {
    if (box.type === "text-run") leaves.push(box);
    if ("children" in box) {
      for (const c of box.children) walk(c);
    }
  };
  walk(result.box);
  return leaves;
}

describe("IFC grapheme-cluster width attribution (Option A: first-unit-full / interior-0)", () => {
  it("a combining-mark grapheme contributes ZERO extra width through the IFC", () => {
    // "e" + combining acute (U+0301) = ONE grapheme "é" (2 code units), then "b" (1).
    // Guard against environments/editors re-normalizing to the precomposed "é" (U+00E9,
    // 1 code unit) — that would silently pass either way and not exercise clustering.
    const text = "e\u0301b"; // e + combining acute (U+0301) + b = 3 code units
    expect(text.length).toBe(3); // guard: fails loudly if re-normalized to precomposed

    const leaves = textRunLeavesOf(text, 500);
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0];

    // The grapheme "é" measures 8px (one mock-shaper grapheme advance) and "b" 8px.
    // The combining mark is an INTERIOR code unit of the "é" grapheme: clusters.find
    // matches only at the grapheme's first code unit, so the interior unit contributes
    // 0. Total = 16, NOT 24 (the old per-code-unit model gave e=8 + combining=8 + b=8).
    expect(leaf.inlineSize).toBe(16);
  });

  it("ASCII is unchanged: two single-code-unit graphemes measure 16 (byte-identical)", () => {
    // The cross-cutting invariant — single-code-unit graphemes (all ASCII/BMP)
    // behave exactly as the old per-code-unit model: "ab" = 8 + 8 = 16.
    const leaves = textRunLeavesOf("ab", 500);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].inlineSize).toBe(16);
  });
});

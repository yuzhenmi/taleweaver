import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutInlineContent } from "./ifc";
import type { TextTransform } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import type { LayoutBox, TextRunBox } from "./layout-box";

const shaper = createMockShaper(8, 16);

/**
 * Lay out a single paragraph with one text child and return its text-run
 * leaves (across all lines). `textTransform` is set on the text child's style
 * (it inherits/computes through the cascade onto `ComputedStyle.textTransform`).
 */
function textRunLeavesOf(
  text: string,
  transform: TextTransform | undefined,
  width: number,
): TextRunBox[] {
  const tree = cascadePass(
    createElementBox("p", { display: "block" }, [
      createTextBox("t", transform !== undefined ? { textTransform: transform } : {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("expected element tree");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
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

describe("IFC text-transform — per-token transform + leaf sourceDisplayLengths", () => {
  it("1:1 uppercase renders transformed display, omits sourceDisplayLengths", () => {
    const leaves = textRunLeavesOf("ab", "uppercase", 500);
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0];
    if (leaf === undefined) throw new Error("expected at least one leaf");
    expect(leaf.text).toBe("AB");
    expect(leaf.inlineSize).toBe(16); // 2 chars * 8px
    // All-1s mapping → omitted (1:1 fast path).
    expect(leaf.sourceDisplayLengths).toBeUndefined();
  });

  it("grow uppercase (ß→SS) records the source→display length map", () => {
    const leaves = textRunLeavesOf("aß", "uppercase", 500); // "aß"
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0];
    if (leaf === undefined) throw new Error("expected at least one leaf");
    expect(leaf.text).toBe("ASS"); // a→A, ß→SS
    expect(leaf.inlineSize).toBe(24); // 3 display chars * 8px
    // 2 SOURCE code units: 'a'→1 display unit, 'ß'→2 display units.
    expect(leaf.sourceDisplayLengths).toEqual([1, 2]);
    // length === offsetLength (the state span).
    expect(leaf.sourceDisplayLengths?.length).toBe(leaf.offsetLength);
    expect(leaf.offsetLength).toBe(2);
  });

  it("none (no transform) renders the source text unchanged, omits sourceDisplayLengths", () => {
    const leaves = textRunLeavesOf("ab", undefined, 500);
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0];
    if (leaf === undefined) throw new Error("expected at least one leaf");
    expect(leaf.text).toBe("ab");
    expect(leaf.sourceDisplayLengths).toBeUndefined();
  });

  it("collapsed whitespace ('a  b' uppercase) does not crash; word leaves stay 1:1", () => {
    // Default whiteSpace collapses the double space to one; the transform path
    // must not perturb the collapse bookkeeping. Word leaves are 1:1 → no SDL.
    const leaves = textRunLeavesOf("a  b", "uppercase", 500);
    const wordLeaves = leaves.filter(l => l.text.trim() !== "");
    expect(wordLeaves.length).toBeGreaterThanOrEqual(1);
    for (const l of wordLeaves) {
      expect(l.sourceDisplayLengths).toBeUndefined();
    }
    // The transform still rendered uppercase.
    expect(leaves.map(l => l.text).join("")).toContain("A");
    expect(leaves.map(l => l.text).join("")).toContain("B");
  });

  it("grow token that ALSO absorbs collapsed whitespace keeps leafSDL.length === offsetLength (I1)", () => {
    // "ß  b" under uppercase with the default (collapsing) whiteSpace. The first
    // leaf is "ß"→"SS" (a GROW token) followed by the collapsed double-space: the
    // first space is KEPT (rendered) and the second is COLLAPSED away, both owned
    // by this leaf's source span (offsetLength 3 = ß + 2 spaces; rendered "SS ").
    // This is the grow-AND-collapse case the earlier tests don't cover: the leaf
    // concat must push the grown token's sourceDisplayLengths then one 0 per
    // collapsed-away unit, so sourceDisplayLengths.length stays === offsetLength.
    const leaves = textRunLeavesOf("ß  b", "uppercase", 500);
    // The grown leaf renders "SS" plus the kept space → "SS ".
    const ssLeaf = leaves.find(l => l.text.startsWith("SS"));
    if (!ssLeaf) throw new Error("expected a 'SS…' leaf for the grown ß word");
    expect(ssLeaf.text).toBe("SS "); // ß→SS + one kept space; 2nd space collapsed
    // CORE INVARIANT: SDL length === offsetLength (the state span the leaf owns).
    expect(ssLeaf.sourceDisplayLengths).toBeDefined();
    expect(ssLeaf.sourceDisplayLengths?.length).toBe(ssLeaf.offsetLength);
    expect(ssLeaf.offsetLength).toBe(3); // ß + 2 source spaces
    // Spot-check the values: ß→2 display units, kept space→1, collapsed space→0.
    expect(ssLeaf.sourceDisplayLengths).toEqual([2, 1, 0]);
  });
});

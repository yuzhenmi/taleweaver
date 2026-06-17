/**
 * Identity-survival contract for `applyAttrsToRange`'s SEAM-MERGE (surgical-inline-ops
 * Phase 1, slice 5). `applyAttrsToRange` already sets a fully-covered run's attrs in
 * place (keeping its `Y.Text`); the remaining identity loss was its post-pass seam
 * normalizer. After slice 5 it uses the in-place twin
 * (`mergeAdjacentSameAttrsTextItemsInPlace`), so when applying an attr makes two runs
 * CONVERGE to same-attrs, the merge RECEIVER keeps its `Y.Text` identity.
 *
 * RED before the swap (the rebuild post-pass replaces both converging runs with a
 * fresh `Y.Text`); GREEN after. Honest Class-2 limit: the DONOR's migrated chars are
 * fresh (not asserted here — only the receiver survival is discriminating).
 */
import { describe, it, expect } from "vitest";
import { applyAttrsToRange } from "./apply-attrs";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { relAt, survives } from "../../test-utils/relpos-survival";

/** doc > [ p( ...runs ) ] — one leaf paragraph whose inline content is `runs`. */
function blockOf(runs: ReturnType<typeof text>[]) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent(runs) }),
    ],
  });
}

const span = (a: number, b: number) =>
  createSpan(createPosition("p" as BlockId, a), createPosition("p" as BlockId, b));

describe("applyAttrsToRange seam-merge — RelativePosition identity survival", () => {
  it("the merge RECEIVER keeps identity when applying an attr makes two runs converge", () => {
    // ["AB"{} , "CD"{bold}]; apply {bold:true} to [0,2) (the "AB" run). "AB" becomes
    // bold IN PLACE (its Y.Text survives the attrs-set), then "AB"{bold} and "CD"{bold}
    // are adjacent same-attrs and merge → "ABCD"{bold}. With the in-place seam normalizer
    // "AB" (receiver, index 0) keeps its Y.Text; a RelativePosition at 'A' survives.
    const s = blockOf([text("AB"), text("CD", { bold: true })]);
    const rel = relAt(s, "p", 0); // 'A' in the receiver run
    const after = applyAttrsToRange(s, span(0, 2), { bold: true }).state;
    expect(survives(rel, after, "A")).toBe(true);
  });
});

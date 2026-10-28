/**
 * Character-survival contract for `applyAttrsToRange`: formatting is `Y.Text.format`,
 * which never deletes or re-mints a character — every character, in and out of the
 * formatted range, keeps its CRDT identity, including where runs converge.
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

describe("applyAttrsToRange — character survival", () => {
  it("every character survives formatting, including where two runs converge", () => {
    const s = blockOf([text("AB"), text("CD", { bold: true })]);
    const rels = [0, 1, 2, 3].map((i) => relAt(s, "p", i));
    const after = applyAttrsToRange(s, span(0, 2), { bold: true }).state;
    "ABCD".split("").forEach((ch, i) => {
      const rel = rels[i];
      if (rel === undefined) throw new Error("missing rel");
      expect(survives(rel, after, ch)).toBe(true);
    });
  });

  it("every character survives a partial-run format (no run split re-mints chars)", () => {
    const s = blockOf([text("ABCDEF")]);
    const rels = [0, 2, 5].map((i) => relAt(s, "p", i));
    const after = applyAttrsToRange(s, span(1, 4), { italic: true }).state;
    expect(rels.map((r, k) => survives(r, after, "ACF".charAt(k)))).toEqual([true, true, true]);
  });
});

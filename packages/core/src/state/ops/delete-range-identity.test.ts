/**
 * Character-survival contract for SAME-BLOCK `deleteRange`: the delete is one
 * offset `Y.Text.delete`, so EVERY surviving character keeps its CRDT identity — a
 * `RelativePosition` anchored anywhere outside the deleted range keeps resolving,
 * including across a seam where two equal-attrs runs now read back as one.
 */
import { describe, it, expect } from "vitest";
import { deleteRange } from "./delete-range";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import { createHistory } from "../history";
import { extractText } from "../extract-text";
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

describe("same-block deleteRange — character survival", () => {
  it("a position in the PREFIX (before the deleted range) survives", () => {
    const s = blockOf([text("ABCDEF")]);
    const rel = relAt(s, "p", 1); // 'B', before the deletion
    const after = deleteRange(s, span(2, 4)).state; // delete "CD"
    expect(survives(rel, after, "B")).toBe(true);
  });

  it("a position in the SUFFIX (after the deleted range) survives", () => {
    const s = blockOf([text("ABCDEF")]);
    const rel = relAt(s, "p", 5); // 'F', after the deletion
    const after = deleteRange(s, span(2, 4)).state; // delete "CD"
    expect(survives(rel, after, "F")).toBe(true);
  });

  it("a position before an intra-run deletion (both endpoints in one run) survives", () => {
    const s = blockOf([text("ABCDEF")]);
    const rel = relAt(s, "p", 0); // 'A', before a deletion fully inside the run
    const after = deleteRange(s, span(2, 4)).state; // delete "CD" — single yText.delete
    expect(survives(rel, after, "A")).toBe(true);
  });

  it("a position in a straddled run that survives the trim keeps resolving (both trim directions)", () => {
    // Two runs "AB"|"CD"(bold); delete [1,3) trims "AB"→"A" (straddle-END, trim at tail)
    // and "CD"→"D" (straddle-START, trim at head, `at=0`). Both survivors keep identity.
    const s = blockOf([text("AB"), text("CD", { strong: true })]);
    const relA = relAt(s, "p", 0); // 'A', in the run trimmed at its end
    const relD = relAt(s, "p", 3); // 'D', in the run trimmed at its start
    const after = deleteRange(s, span(1, 3)).state;
    expect(survives(relA, after, "A")).toBe(true);
    expect(survives(relD, after, "D")).toBe(true);
  });

  it("SEAM-MERGE: a position in the merge RECEIVER (prefix) survives the absorb", () => {
    // [A]{} [del]{bold} [B]{} — delete the middle bold run; "A" and "B" are same-attrs
    // and seam-merge into one run. A position in "A" (the receiver) must survive even
    // as "B" is appended into its Y.Text.
    const s = blockOf([text("A"), text("del", { strong: true }), text("B")]);
    const rel = relAt(s, "p", 0); // 'A', the seam-merge receiver
    const after = deleteRange(s, span(1, 4)).state; // delete "del"
    expect(survives(rel, after, "A")).toBe(true);
  });

  it("SEAM: the chars after the seam survive too (no run is re-minted)", () => {
    const s = blockOf([text("A"), text("del", { strong: true }), text("B")]);
    const rel = relAt(s, "p", 4); // 'B', after the deleted run
    const after = deleteRange(s, span(1, 4)).state;
    expect(survives(rel, after, "B")).toBe(true);
  });

  it("UNDO of a surgical delete restores the content and does not orphan a suffix anchor", () => {
    // Undo guardrail: after undo the content is restored AND a RelativePosition in
    // the suffix still resolves to its live char — undo does not orphan it.
    const s = blockOf([text("ABCDEF")]);
    const history = createHistory(s);
    const rel = relAt(s, "p", 5); // 'F', in the suffix
    const op = deleteRange(s, span(2, 4)); // delete "CD" → "ABEF"
    history.commit(op, { before: span(2, 4), after: span(2, 2) });
    expect(survives(rel, op.state, "F")).toBe(true); // survives the delete itself

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(extractText(undone.state, span(0, 6))).toBe("ABCDEF"); // content restored
    expect(survives(rel, undone.state, "F")).toBe(true); // undo did not orphan the suffix anchor
  });
});

/**
 * Identity-survival contract for SAME-BLOCK `replaceRange` (surgical-inline-ops
 * Phase 1, slice 2). A same-block replace composes the surgical same-block
 * `deleteRange` (slice 1, identity-preserving in place) with an identity-aware
 * `split-in-place` insert, so a `RelativePosition` anchored in a NON-straddled
 * surviving run keeps resolving — extending within-block selection rebasing from
 * delete to the most common rich-text edit (type-over-a-selection / replace-one).
 *
 * RED before the slice-2 branch (today's `replaceRange` forces a full-replace
 * insert via `planInsertTextFullReplace`, orphaning every run); GREEN after.
 *
 * FIXTURE RULE (load-bearing): prefix and suffix runs carry DISTINCT attrs so the
 * DELETE step's seam-merge does NOT fire (same-attrs neighbours would collapse into
 * one fresh `Y.Text`, orphaning both before the insert runs). Insertion is at the
 * prefix/suffix BOUNDARY (`within === 0`, no run split). The honest Class-2 limit —
 * a position in the run that STRADDLES the insertion point orphans — is its own test.
 */
import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
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

describe("same-block replaceRange — RelativePosition identity survival", () => {
  // Fixture "AB"{bold} | "CD"{} | "EF"{italic}: bold≠italic ⇒ deleting "CD" does NOT
  // seam-merge the survivors. Insert "X"{underline} at offset 2 = the boundary between
  // the survivors (within===0, no run split). underline≠bold,italic ⇒ inserted run stays
  // distinct. mergedItems = ["AB"{bold}, "EF"{italic}]; result = ["AB"{bold}, "X"{underline}, "EF"{italic}].
  it("a position in the PREFIX survives a same-block replaceRange", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const rel = relAt(s, "p", 0); // 'A' in the bold prefix
    const after = replaceRange(s, span(2, 4), "X", { underline: true }).state;
    expect(survives(rel, after, "A")).toBe(true);
  });

  it("a position in the SUFFIX survives a same-block replaceRange", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const rel = relAt(s, "p", 0, /* itemIndex */ 2); // 'E' in the italic suffix
    const after = replaceRange(s, span(2, 4), "X", { underline: true }).state;
    expect(survives(rel, after, "E")).toBe(true);
  });

  it("STRADDLE: a position in the run that straddles the insertion point orphans (Class-2 limit)", () => {
    // Replace [1,2) inside a single run "ABCD" with "X" → "AXCD": the surgical delete trims
    // "ABCD"→"ACD" in place (identity preserved), but the split-in-place insert at offset 1
    // then SPLITS that run ("ACD" → "A" + "CD"), rebuilding its Y.Text (Yjs cannot split a
    // Y.Text preserving identity). A position at 'D' (after the insertion) orphans. Honest.
    const s = blockOf([text("ABCD")]);
    const rel = relAt(s, "p", 3); // 'D', in the straddled run, after the insertion seam
    const after = replaceRange(s, span(1, 2), "X", { underline: true }).state;
    expect(survives(rel, after, "D")).toBe(false);
  });

  it("UNDO of a same-block replaceRange restores content and does not orphan a survivor", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const history = createHistory(s);
    const rel = relAt(s, "p", 0); // 'A' in the bold prefix
    const op = replaceRange(s, span(2, 4), "X", { underline: true }); // "ABXEF"
    history.commit(op, { before: span(2, 4), after: span(3, 3) });
    expect(survives(rel, op.state, "A")).toBe(true); // survives the replace itself

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(extractText(undone.state, span(0, 6))).toBe("ABCDEF"); // content restored
    expect(survives(rel, undone.state, "A")).toBe(true); // undo did not orphan the prefix anchor
  });
});

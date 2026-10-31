/**
 * Character-survival contract for SAME-BLOCK `replaceRange`: an offset delete +
 * an offset insert on the block's `Y.Text`, so EVERY character outside the
 * replaced range keeps its CRDT identity — including chars in the run the
 * insertion lands inside (no run is ever split by re-minting).
 */
import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import { createHistory } from "../history";
import { extractText } from "../extract-text";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";
import { relAt, survives } from "../../test-utils/relpos-survival";

/** doc > [ p( ...runs ) ] — one leaf paragraph whose inline content is `runs`. */
function blockOf(runs: ReturnType<typeof text>[]) {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent(runs) }),
    ],
  });
}

const span = (a: number, b: number) =>
  createSpan(createPosition("p" as BlockId, a), createPosition("p" as BlockId, b));

describe("same-block replaceRange — character survival", () => {
  // Fixture "AB"{bold} | "CD"{} | "EF"{italic}: bold≠italic ⇒ deleting "CD" does NOT
  // seam-merge the survivors. Insert "X"{underline} at offset 2 = the boundary between
  // the survivors (within===0, no run split). underline≠bold,italic ⇒ inserted run stays
  // distinct. mergedItems = ["AB"{bold}, "EF"{italic}]; result = ["AB"{bold}, "X"{underline}, "EF"{italic}].
  it("a position in the PREFIX survives a same-block replaceRange", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const rel = relAt(s, "p", 0); // 'A' in the bold prefix
    const after = replaceRange(s, span(2, 4), "X", { underline: true }).document;
    expect(survives(rel, after, "A")).toBe(true);
  });

  it("a position in the SUFFIX survives a same-block replaceRange", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const rel = relAt(s, "p", 4); // 'E' in the italic suffix
    const after = replaceRange(s, span(2, 4), "X", { underline: true }).document;
    expect(survives(rel, after, "E")).toBe(true);
  });

  it("a position in the run the differently-formatted insertion lands INSIDE survives", () => {
    const s = blockOf([text("ABCD")]);
    const rel = relAt(s, "p", 3); // 'D', after the insertion point inside the run
    const after = replaceRange(s, span(1, 2), "X", { underline: true }).document;
    expect(survives(rel, after, "D")).toBe(true);
  });

  it("UNDO of a same-block replaceRange restores content and does not orphan a survivor", () => {
    const s = blockOf([text("AB", { bold: true }), text("CD"), text("EF", { italic: true })]);
    const history = createHistory(s);
    const rel = relAt(s, "p", 0); // 'A' in the bold prefix
    const op = replaceRange(s, span(2, 4), "X", { underline: true }); // "ABXEF"
    history.commit(op, { before: span(2, 4), after: span(3, 3) });
    expect(survives(rel, op.document, "A")).toBe(true); // survives the replace itself

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(extractText(undone.document, span(0, 6))).toBe("ABCDEF"); // content restored
    expect(survives(rel, undone.document, "A")).toBe(true); // undo did not orphan the prefix anchor
  });
});

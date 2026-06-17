/**
 * Unit tests for the outline-signature cache key (slice 3-series TOC perf
 * contract). `computeOutlineSignature` derives the ordered heading list (the
 * exact inputs a TOC's entry lines come from) + the set of `table-of-contents`
 * anchor blocks; `outlineSignaturesEqual` answers "did the OUTLINE change",
 * driving whether the incremental render must re-derive existing TOCs.
 */
import { describe, it, expect } from "vitest";
import {
  computeOutlineSignature,
  outlineSignaturesEqual,
  EMPTY_OUTLINE_SIGNATURE,
} from "./outline";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import { asBlockId, insertText, createPosition } from "../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const H1 = "h1";
const H2 = "h2";
const TOC = "toc";

/** A doc: h1 "Introduction", a paragraph, h2 "Details", then a TOC block. */
function docWithHeadingsAndToc() {
  return buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: H1, lastChildId: TOC }),
      buildBlock({
        id: H1,
        type: "heading",
        parentId: "doc",
        nextSiblingId: "p",
        attrs: { level: 1 },
        inlineContent: inlineContent([text("Introduction")]),
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: H1,
        nextSiblingId: H2,
        inlineContent: inlineContent([text("body")]),
      }),
      buildBlock({
        id: H2,
        type: "heading",
        parentId: "doc",
        prevSiblingId: "p",
        nextSiblingId: TOC,
        attrs: { level: 2 },
        inlineContent: inlineContent([text("Details")]),
      }),
      buildBlock({
        id: TOC,
        type: "table-of-contents",
        parentId: "doc",
        prevSiblingId: H2,
        inlineContent: null,
      }),
    ],
  });
}

describe("computeOutlineSignature", () => {
  it("collects heading ids, TOC anchor ids, and the ordered (id,level,text) signature", () => {
    const sig = computeOutlineSignature(docWithHeadingsAndToc(), "suggesting");

    // The heading id set is the signature's blockIds (not stored separately).
    expect(sig.signature.map((e) => e.blockId)).toEqual([asBlockId(H1), asBlockId(H2)]);
    expect([...sig.tocAnchorIds]).toEqual([asBlockId(TOC)]);
    expect(sig.signature).toHaveLength(2);
    expect(sig.signature[0]).toEqual({ blockId: asBlockId(H1), level: 1, text: "Introduction" });
    expect(sig.signature[1]).toEqual({ blockId: asBlockId(H2), level: 2, text: "Details" });
  });

  it("EMPTY_OUTLINE_SIGNATURE is empty (no headings, no TOC anchors)", () => {
    expect(EMPTY_OUTLINE_SIGNATURE.tocAnchorIds.size).toBe(0);
    expect(EMPTY_OUTLINE_SIGNATURE.signature).toHaveLength(0);
  });
});

describe("outlineSignaturesEqual", () => {
  it("is true for the same signature instance and for two equal signatures", () => {
    const state = docWithHeadingsAndToc();
    const a = computeOutlineSignature(state, "suggesting");
    const b = computeOutlineSignature(state, "suggesting");
    expect(outlineSignaturesEqual(a, a)).toBe(true);
    expect(outlineSignaturesEqual(a, b)).toBe(true);
  });

  it("is FALSE after a heading's display text changes", () => {
    const state = docWithHeadingsAndToc();
    const before = computeOutlineSignature(state, "suggesting");
    const { state: next } = insertText(
      state,
      createPosition(asBlockId(H1), "Introduction".length),
      "!",
      {},
    );
    const after = computeOutlineSignature(next, "suggesting");
    expect(outlineSignaturesEqual(before, after)).toBe(false);
    expect(nth(after.signature, 0, "signature entry").text).toBe("Introduction!");
  });

  it("is TRUE after a NON-heading change (editing a paragraph)", () => {
    const state = docWithHeadingsAndToc();
    const before = computeOutlineSignature(state, "suggesting");
    const { state: next } = insertText(
      state,
      createPosition(asBlockId("p"), "body".length),
      " more",
      {},
    );
    const after = computeOutlineSignature(next, "suggesting");
    expect(outlineSignaturesEqual(before, after)).toBe(true);
  });
});

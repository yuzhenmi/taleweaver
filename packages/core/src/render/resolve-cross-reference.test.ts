import { describe, it, expect } from "vitest";
import { resolveCrossReference, BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import type { BlockId, State } from "../state";
import type { CounterValue } from "../numbering";

/** doc → [list-item "li" (a numbered item), heading "h" "Title", container "c" (no inlineContent)]. */
function doc(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "c" }),
      buildBlock({ id: "li", type: "list-item", parentId: "doc", nextSiblingId: "h", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("first item")]) }),
      buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "li", nextSiblingId: "c", attrs: { level: 1 }, inlineContent: inlineContent([text("Title")]) }),
      buildBlock({ id: "c", type: "section", parentId: "doc", prevSiblingId: "h", firstChildId: null, lastChildId: null }),
    ],
  });
}

const numbering: ReadonlyMap<BlockId, CounterValue> = new Map([
  ["li" as BlockId, { value: 3, formatted: "3" }],
]);

describe("resolveCrossReference", () => {
  it("number mode → the target's formatted counter from the numbering map", () => {
    expect(resolveCrossReference(doc(), numbering, { targetId: "li" as BlockId, refMode: "number" })).toBe("3");
  });

  it("number mode, target absent from the numbering map (unnumbered / deleted) → broken-ref", () => {
    expect(resolveCrossReference(doc(), numbering, { targetId: "h" as BlockId, refMode: "number" })).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(resolveCrossReference(doc(), numbering, { targetId: "gone" as BlockId, refMode: "number" })).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("text mode → the target block's full text", () => {
    expect(resolveCrossReference(doc(), numbering, { targetId: "h" as BlockId, refMode: "text" })).toBe("Title");
    expect(resolveCrossReference(doc(), numbering, { targetId: "li" as BlockId, refMode: "text" })).toBe("first item");
  });

  it("text mode, target missing → broken-ref", () => {
    expect(resolveCrossReference(doc(), numbering, { targetId: "gone" as BlockId, refMode: "text" })).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("text mode, target is not inline-bearing (a container) → broken-ref", () => {
    expect(resolveCrossReference(doc(), numbering, { targetId: "c" as BlockId, refMode: "text" })).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("text mode, an empty target → empty string (the target EXISTS — not broken)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveCrossReference(state, numbering, { targetId: "p" as BlockId, refMode: "text" })).toBe("");
  });
});

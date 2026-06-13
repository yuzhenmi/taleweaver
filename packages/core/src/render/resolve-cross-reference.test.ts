import { describe, it, expect } from "vitest";
import { resolveCrossReference, BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import { buildBlock, buildState, inlineContent, text, embed } from "../test-utils/state-builders";
import {
  type BlockId,
  type State,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
} from "../state";
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
  it("number mode → the target's formatted counter from the numbering map (view-independent)", () => {
    const target = { targetId: "li" as BlockId, refMode: "number" as const };
    expect(resolveCrossReference(doc(), numbering, target)).toBe("3");
    // The counter comes from the per-render numbering map (already view-correct);
    // number mode returns BEFORE the view param is consulted, so it is invariant
    // across the suggestion views (unlike text mode — XR-1).
    expect(resolveCrossReference(doc(), numbering, target, "final")).toBe("3");
    expect(resolveCrossReference(doc(), numbering, target, "original")).toBe("3");
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

  it("text mode → embeds in the target contribute CLEAN caption text, not U+FFFC / \\t / \\n (XR-2)", () => {
    // A heading "Part" + hard-break + "One" + tab + "Two" + a footnote anchor.
    // The clipboard serializer would yield "Part\nOne\tTwo￼"; the cross-ref
    // display serializer collapses breaks/tabs to a space and drops embeds.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "h" }),
        buildBlock({
          id: "h", type: "heading", parentId: "doc", attrs: { level: 1 },
          inlineContent: inlineContent([
            text("Part"),
            embed("hard-break"),
            text("One"),
            embed("tab"),
            text("Two"),
            embed("footnote-anchor", { footnoteId: "f1" }),
          ]),
        }),
      ],
    });
    expect(resolveCrossReference(state, numbering, { targetId: "h" as BlockId, refMode: "text" })).toBe(
      "Part One Two",
    );
  });

  it("text mode resolves under the render suggestionView — final/original preview (XR-1)", () => {
    // Heading = "Keep " (live) + "Added" (a pending INSERTION). The cross-ref
    // caption must match the previewed projection of the target:
    //   suggesting (literal) / final (accept all) → "Keep Added"
    //   original (reject all) → "Keep " (the insertion is removed)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "h" }),
        buildBlock({
          id: "h", type: "heading", parentId: "doc", attrs: { level: 1 },
          inlineContent: inlineContent([
            text("Keep "),
            text("Added", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          ]),
        }),
      ],
    });
    const target = { targetId: "h" as BlockId, refMode: "text" as const };
    expect(resolveCrossReference(state, numbering, target)).toBe("Keep Added"); // default "suggesting"
    expect(resolveCrossReference(state, numbering, target, "final")).toBe("Keep Added");
    expect(resolveCrossReference(state, numbering, target, "original")).toBe("Keep ");
  });

  it("text mode under original view, a pending DELETION in the target is KEPT (XR-1 mirror)", () => {
    // Heading = "Stay" + "Cut" (pending DELETION). final (accept) drops "Cut";
    // original (reject) keeps it.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "h" }),
        buildBlock({
          id: "h", type: "heading", parentId: "doc", attrs: { level: 1 },
          inlineContent: inlineContent([
            text("Stay"),
            text("Cut", { [DELETION_SUGGESTION_ATTR]: "d1" }),
          ]),
        }),
      ],
    });
    const target = { targetId: "h" as BlockId, refMode: "text" as const };
    expect(resolveCrossReference(state, numbering, target, "final")).toBe("Stay");
    expect(resolveCrossReference(state, numbering, target, "original")).toBe("StayCut");
  });
});

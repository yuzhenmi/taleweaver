import { describe, it, expect } from "vitest";
import { resolveCrossReference, BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import { buildBlock, buildDocument, inlineContent, text, embed } from "../test-utils/document-builders";
import {
  type BlockId,
  type Document,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
} from "../state";
import type { CounterValue } from "../numbering";
import { createPosition, type BookmarkRange } from "../state";

/** A bookmark range over units [0, len) of block `id` (fields target bookmarks). */
function over(id: string, len: number): BookmarkRange {
  return { start: createPosition(id as BlockId, 0), end: createPosition(id as BlockId, len) };
}

/** doc → [list-item "li" (a numbered item), heading "h" "Title", container "c" (no inlineContent)]. */
function doc(): Document {
  return buildDocument({
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
    const target = { range: over("li", 10), refMode: "number" as const };
    expect(resolveCrossReference(doc(), numbering, target)).toBe("3");
    // The counter comes from the per-render numbering map (already view-correct);
    // number mode returns BEFORE the view param is consulted, so it is invariant
    // across the suggestion views (unlike text mode — XR-1).
    expect(resolveCrossReference(doc(), numbering, target, "final")).toBe("3");
    expect(resolveCrossReference(doc(), numbering, target, "original")).toBe("3");
  });

  it("number mode, the bookmark start's paragraph is not numbered → broken-ref", () => {
    expect(resolveCrossReference(doc(), numbering, { range: over("h", 5), refMode: "number" })).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("text mode → the target block's full text", () => {
    expect(resolveCrossReference(doc(), numbering, { range: over("h", 5), refMode: "text" })).toBe("Title");
    expect(resolveCrossReference(doc(), numbering, { range: over("li", 10), refMode: "text" })).toBe("first item");
    // A bookmark over part of the text reads just that part (Word's REF).
    expect(resolveCrossReference(doc(), numbering, { range: { start: createPosition("li" as BlockId, 6), end: createPosition("li" as BlockId, 10) }, refMode: "text" })).toBe("item");
  });

  it("text mode, an empty bookmark → empty string (it EXISTS — not broken)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveCrossReference(document, numbering, { range: over("p", 0), refMode: "text" })).toBe("");
  });

  it("text mode → embeds in the target contribute CLEAN caption text, not U+FFFC / \\t / \\n (XR-2)", () => {
    // A heading "Part" + hard-break + "One" + tab + "Two" + a footnote anchor.
    // The clipboard serializer would yield "Part\nOne\tTwo￼"; the cross-ref
    // display serializer collapses breaks/tabs to a space and drops embeds.
    const document = buildDocument({
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
    expect(resolveCrossReference(document, numbering, { range: over("h", 14), refMode: "text" })).toBe(
      "Part One Two",
    );
  });

  it("text mode resolves under the render suggestionView — final/original preview (XR-1)", () => {
    // Heading = "Keep " (live) + "Added" (a pending INSERTION). The cross-ref
    // caption must match the previewed projection of the target:
    //   suggesting (literal) / final (accept all) → "Keep Added"
    //   original (reject all) → "Keep " (the insertion is removed)
    const document = buildDocument({
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
    const target = { range: over("h", 10), refMode: "text" as const };
    expect(resolveCrossReference(document, numbering, target)).toBe("Keep Added"); // default "suggesting"
    expect(resolveCrossReference(document, numbering, target, "final")).toBe("Keep Added");
    expect(resolveCrossReference(document, numbering, target, "original")).toBe("Keep ");
  });

  it("text mode under original view, a pending DELETION in the target is KEPT (XR-1 mirror)", () => {
    // Heading = "Stay" + "Cut" (pending DELETION). final (accept) drops "Cut";
    // original (reject) keeps it.
    const document = buildDocument({
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
    const target = { range: over("h", 7), refMode: "text" as const };
    expect(resolveCrossReference(document, numbering, target, "final")).toBe("Stay");
    expect(resolveCrossReference(document, numbering, target, "original")).toBe("StayCut");
  });
});

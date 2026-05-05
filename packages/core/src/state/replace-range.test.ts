import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("replaceRange — basic single-block replacement", () => {
  // doc > [p("hello world")]
  // Replace range [3, 7) with "FOO" — drops "lo w", inserts "FOO" at position 3.
  // Expected: p("helFOOorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range and inserts the replacement text at the seam", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", {});

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helFOOorld", attrs: {} });

    // dirtyIds: just the modified block (deleteRange dirties "p"; insertText dirties "p"; union = {"p"}).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

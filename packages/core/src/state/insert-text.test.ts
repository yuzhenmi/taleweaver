import { describe, it, expect } from "vitest";
import { insertText } from "./insert-text";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition } from "./block-position";
import type { BlockId } from "./block-id";

describe("insertText — middle of single text item", () => {
  // doc > [p("hello world")]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello world")]),
        }),
      ],
    });

  it("inserts the text into the middle of the existing item, preserving attrs", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), " beautiful", {});
    const updated = result.state.blocks.get("p" as BlockId);
    expect(updated?.inlineContent?.items).toHaveLength(1);
    const item = updated?.inlineContent?.items[0];
    expect(item?.kind).toBe("text");
    if (item?.kind === "text") {
      expect(item.text).toBe("hello beautiful world");
      expect(item.attrs).toEqual({});
    }
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), " beautiful", {});
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("preserves immutability + structural sharing (does not mutate original; unmodified blocks share identity)", () => {
    const state = fixture();
    const beforeP = state.blocks.get("p" as BlockId);
    const beforeDoc = state.blocks.get("doc" as BlockId);
    const result = insertText(state, createPosition("p" as BlockId, 5), " x", {});
    // Original state and its blocks are not mutated.
    expect(result.state).not.toBe(state);
    expect(result.state.blocks.get("p" as BlockId)).not.toBe(beforeP);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
    // Unmodified blocks (doc) share identity — structural sharing.
    expect(result.state.blocks.get("doc" as BlockId)).toBe(beforeDoc);
  });

  it("normalizes already-unnormalized inline content (merges adjacent same-attrs text items in input)", () => {
    // Input is unnormalized: three adjacent same-attrs text items. The
    // post-pass should merge them all (along with any new insertion).
    // createInlineContent does NOT normalize, so this is a real input shape.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), text("b"), text("c")]),
        }),
      ],
    });
    // Insert at offset 1 (between "a" and "b"): all attrs equal, so the result should be one merged item.
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aXbc", attrs: {} });
  });
});

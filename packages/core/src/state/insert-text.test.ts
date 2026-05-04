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

describe("insertText — offset 0 (beginning of block)", () => {
  it("prepends text in front of the existing first item (different attrs → new run)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });

  it("merges with the first item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });
  });
});

describe("insertText — end of block (offset === inlineContentLength)", () => {
  it("appends text after the last item (different attrs → new run)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "!", attrs: { italic: true } });
  });

  it("merges with the last item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello!", attrs: {} });
  });
});

describe("insertText — empty block", () => {
  it("creates the first text item in an empty block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hi", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hi", attrs: { bold: true } });
  });
});

describe("insertText — split a different-attrs text item", () => {
  // Block: [text("helloworld") with attrs {}]
  // Insert "BOLD" with { bold: true } at offset 5
  // Expected: [text("hello") {}, text("BOLD") {bold:true}, text("world") {}]
  it("splits the affected text item into prefix + new + suffix when attrs differ", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("helloworld")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "BOLD", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });
});

describe("insertText — at boundary between two text items", () => {
  // Block: [text("hello") {}, text("world") {bold:true}]  (length 10)
  // Insert " " {} at offset 5 (the boundary between the two items)
  // Expected: text(" ") merges with the prev item (same attrs), giving:
  //   [text("hello ") {}, text("world") {bold:true}]
  it("merges with the previous item when boundary attrs match the prev item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), " ", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("creates a new run when boundary attrs match neither side", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "X", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("does NOT merge two same-attrs runs across a different-attrs insert (contract pin)", () => {
    // [text("a") {bold}, text("b") {bold}] insert "X" {italic} at offset 1
    // Expected: [text("a") {bold}, text("X") {italic}, text("b") {bold}]
    // — the two {bold} runs do NOT collapse across the {italic} run.
    // This pins the contract: the merge pass walks linearly and only
    // merges immediately adjacent same-attrs items; it never collapses
    // across an intervening different-attrs item.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a", { bold: true }), text("b", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", { italic: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("insertText — adjacent to embed items", () => {
  // Block: [text("a") {}, embed("image"), text("b") {}]  (length 3)

  it("inserts immediately before an embed when offset === embed start", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 1 = end of "a" / start of embed. Algorithm prefers trailing-edge of text item, so "X" merges with "a".
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aX" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });

  it("inserts immediately after an embed when offset === embed end", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 2 = end of embed / start of "b". Algorithm puts text BEFORE the next text item; merges with "b" if attrs match.
    const result = insertText(state, createPosition("p" as BlockId, 2), "Y", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "Yb" });
  });

  it("inserts at the start of a block whose first item is an embed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("image"), text("b")]),
        }),
      ],
    });
    // offset 0 = before embed.
    const result = insertText(state, createPosition("p" as BlockId, 0), "X", {});
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });
});

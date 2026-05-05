import { describe, it, expect } from "vitest";
import { splitBlockAtPosition } from "./split-block";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";

describe("splitBlockAtPosition — single-block, mid-text-item split", () => {
  // doc > [p("hello world")]
  // Split at offset 5: p_left = "hello", new block = " world"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("splits the leaf block into two adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    // Original block: same id, content "hello", nextSibling rewired to new block.
    const left = result.state.blocks.get("p" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p");
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(left?.nextSiblingId).toBe("p2-0");

    // New block: id from allocator, content " world", parentId same as original.
    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right).toBeDefined();
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");
    expect(right?.nextSiblingId).toBeNull();
    expect(right?.firstChildId).toBeNull();
    expect(right?.lastChildId).toBeNull();
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: " world" });

    // Parent: lastChildId updated to new block (original was the only/last child).
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p");
    expect(parent?.lastChildId).toBe("p2-0");

    // dirtyIds: { p, p2-0, doc }. (No nextSibling existed to rewire; parent.lastChildId changed → parent dirty.)
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });
});

describe("splitBlockAtPosition — split at text-item boundary", () => {
  it("splits cleanly between two text items without splitting either", () => {
    // Block: [text("hello") {}, text(" world") { italic: true }] — total length 11.
    // Split at offset 5 — exactly between the two items.
    // Expected: left [text("hello")], right [text(" world", italic)]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("hello"), text(" world", { italic: true })]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: " world", attrs: { italic: true } });
  });
});

describe("splitBlockAtPosition — split inside a multi-item block (preserves attrs on both halves)", () => {
  it("splits inside the styled middle of three text items, preserving attrs on both halves of the split item", () => {
    // Block: [text("ab", {}), text("cd", { bold: true }), text("ef", {})] — normalized
    // (no two adjacent items share attrs). Total length 6.
    // Split at offset 3 — falls inside the bold "cd" at within=1.
    // Expected:
    //   left  = [text("ab", {}), text("c", { bold: true })]
    //   right = [text("d", { bold: true }), text("ef", {})]
    // Both halves of the split bold item must carry { bold: true } — this is the
    // most likely place an attrs-preservation bug would silently strip formatting
    // (e.g., createTextItem(slice) without the attrs arg). Pin it explicitly.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("ab"),
            text("cd", { bold: true }),
            text("ef"),
          ]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 3), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ text: "ab", attrs: {} });
    expect(left?.inlineContent?.items[1]).toMatchObject({ text: "c", attrs: { bold: true } });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ text: "d", attrs: { bold: true } });
    expect(right?.inlineContent?.items[1]).toMatchObject({ text: "ef", attrs: {} });
  });
});

describe("splitBlockAtPosition — split at embed-item boundaries", () => {
  it("splits at the leading edge of an embed item (offset = pre-embed length)", () => {
    // Block: [text("a"), embed("img"), text("b")] — total length 3.
    // Split at offset 1 — exactly at the leading edge of the embed.
    // Expected: left [text("a")], right [embed("img"), text("b")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right?.inlineContent?.items[1]).toMatchObject({ kind: "text", text: "b" });
  });

  it("splits at the trailing edge of an embed item (offset = pre-embed length + 1)", () => {
    // Same fixture as above. Split at offset 2 — just after the embed.
    // Expected: left [text("a"), embed("img")], right [text("b")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
    expect(left?.inlineContent?.items[1]).toMatchObject({ kind: "embed", embedType: "img" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "b" });
  });

  it("splits at offset 0 in a block whose first item is an embed", () => {
    // Block: [embed("img"), text("a")] — total length 2.
    // Split at offset 0 — leading edge of the embed.
    // Expected: left [], right [embed("img"), text("a")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("img"), text("a")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(2);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right?.inlineContent?.items[1]).toMatchObject({ kind: "text", text: "a" });
  });
});

describe("splitBlockAtPosition — edge offsets", () => {
  it("offset=0 produces an empty original block + new block holding all original content", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    // Parent's lastChildId rewired (original was the last child).
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");

    // dirtyIds: original block, new block, parent (lastChildId changed).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("offset=total length produces a full original block + empty new block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);

    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("splits an empty leaf block at offset 0 into two empty siblings", () => {
    // Empty paragraph — pressing Enter on an empty line should produce two empty paragraphs.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = result.state.blocks.get("p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");

    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });
});

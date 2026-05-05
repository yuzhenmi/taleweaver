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

describe("splitBlockAtPosition — linked-list correctness", () => {
  // doc > [p1, p2, p3] — split p2.
  const threeChildFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });

  it("middle child split: prev sibling's nextSiblingId unchanged; next sibling's prevSiblingId rewired; parent unchanged", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);

    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBe("p2b-0"); // rewired
    expect(result.state.blocks.get("p2b-0" as BlockId)?.prevSiblingId).toBe("p2");
    expect(result.state.blocks.get("p2b-0" as BlockId)?.nextSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p2b-0"); // rewired

    // Parent's first/last unchanged (split was a middle child).
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p3");

    // dirtyIds: { p2, p2b-0, p3 }. Parent NOT dirty (no first/last change).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p2b-0", "p3"]));
  });

  it("first-child split: parent's firstChildId unchanged (still original); next sibling's prevSiblingId rewired", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p1b");
    const result = splitBlockAtPosition(state, createPosition("p1" as BlockId, 1), allocator);

    expect(result.state.blocks.get("p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p1b-0");
    expect(result.state.blocks.get("p1b-0" as BlockId)?.prevSiblingId).toBe("p1");
    expect(result.state.blocks.get("p1b-0" as BlockId)?.nextSiblingId).toBe("p2");
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe("p1b-0"); // rewired

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p1b-0", "p2"]));
  });

  it("last-child split: parent's lastChildId rewired to new block; no next sibling existed", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p3b");
    const result = splitBlockAtPosition(state, createPosition("p3" as BlockId, 2), allocator);

    expect(result.state.blocks.get("p3" as BlockId)?.nextSiblingId).toBe("p3b-0");
    expect(result.state.blocks.get("p3b-0" as BlockId)?.prevSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3b-0" as BlockId)?.nextSiblingId).toBeNull();

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p3b-0"); // rewired

    // dirtyIds: { p3, p3b-0, doc }. Parent dirty because lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p3", "p3b-0", "doc"]));
  });

  it("nested-block split: leaf nested inside a section uses the section as the parent for sibling linkage", () => {
    // doc > section > [p_only] — split p_only.
    // The section is the parent of p_only; the section's lastChildId should be rewired to the new block.
    // doc's child pointers (firstChildId/lastChildId = "section") are unchanged.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p_only", lastChildId: "p_only" }),
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("pNew");
    const result = splitBlockAtPosition(state, createPosition("p_only" as BlockId, 3), allocator);

    // New block's parent is the section, NOT the doc.
    const right = result.state.blocks.get("pNew-0" as BlockId);
    expect(right?.parentId).toBe("section");

    // Section's child pointers: firstChildId unchanged (still p_only), lastChildId rewired to new block.
    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p_only");
    expect(section?.lastChildId).toBe("pNew-0");

    // doc's child pointers untouched.
    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    // dirtyIds: section dirtied (lastChildId changed); doc NOT dirtied.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p_only", "pNew-0", "section"]));
  });
});

describe("splitBlockAtPosition — block-level invariants", () => {
  it("new block inherits type, attrs, and parentId from the original", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          attrs: { level: 2, ordered: true },
          parentId: "doc",
          inlineContent: createInlineContent([text("hello")]),
        }),
      ],
    });
    const allocator = createTestAllocator("li2");
    const result = splitBlockAtPosition(state, createPosition("li" as BlockId, 3), allocator);

    const right = result.state.blocks.get("li2-0" as BlockId);
    expect(right?.type).toBe("list-item");
    expect(right?.attrs).toEqual({ level: 2, ordered: true });
    expect(right?.parentId).toBe("doc");
  });

  it("new block id comes from allocator.allocate()", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("custom");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    expect(result.state.blocks.has("custom-0" as BlockId)).toBe(true);
    expect(result.state.blocks.get("p" as BlockId)?.nextSiblingId).toBe("custom-0");
  });

  it("preserves structural sharing: untouched blocks retain object identity", () => {
    // doc > [p1, p2, p3] — split p2; p1 should keep identity. (p3 is rewired, so its identity changes.)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });
    const beforeP1 = state.blocks.get("p1" as BlockId);
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);
    expect(result.state.blocks.get("p1" as BlockId)).toBe(beforeP1);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    expect(result.state).not.toBe(state);
    // Original state's "p" block still has its original content + nextSibling.
    expect(state.blocks.get("p" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "hello" });
    expect(state.blocks.get("p" as BlockId)?.nextSiblingId).toBeNull();
    expect(state.blocks.has("p2-0" as BlockId)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  splitBlockAtPosition,
  splitBlockAtPositionInTx,
  planSplitBlockAtPosition,
} from "./split-block";
import { planInsertText, insertTextInTx } from "./insert-text";
import { applyOperation, getBlock } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { createHistory } from "../history";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { createPosition, createSpan } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";

describe("splitBlockAtPosition — single-block, mid-text-item split", () => {
  // doc > [p("hello world")]
  // Split at offset 5: p_left = "hello", new block = " world"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });

  it("splits the leaf block into two adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    // Original block: same id, content "hello", nextSibling rewired to new block.
    const left = getBlock(result.state, "p" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p");
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(left?.nextSiblingId).toBe("p2-0");

    // New block: id from allocator, content " world", parentId same as original.
    const right = getBlock(result.state, "p2-0" as BlockId);
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
    const parent = getBlock(result.state, "doc" as BlockId);
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
          inlineContent: inlineContent([text("hello"), text(" world", { italic: true })]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });

    const right = getBlock(result.state, "p2-0" as BlockId);
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
    // (e.g., a text-item builder called without the attrs arg). Pin it explicitly.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            text("cd", { bold: true }),
            text("ef"),
          ]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 3), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ text: "ab", attrs: {} });
    expect(left?.inlineContent?.items[1]).toMatchObject({ text: "c", attrs: { bold: true } });

    const right = getBlock(result.state, "p2-0" as BlockId);
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
          inlineContent: inlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });

    const right = getBlock(result.state, "p2-0" as BlockId);
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
          inlineContent: inlineContent([text("a"), embed("img"), text("b")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(2);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
    expect(left?.inlineContent?.items[1]).toMatchObject({ kind: "embed", embedType: "img" });

    const right = getBlock(result.state, "p2-0" as BlockId);
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
          inlineContent: inlineContent([embed("img"), text("a")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = getBlock(result.state, "p2-0" as BlockId);
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = getBlock(result.state, "p2-0" as BlockId);
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    // Parent's lastChildId rewired (original was the last child).
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2-0");

    // dirtyIds: original block, new block, parent (lastChildId changed).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("offset=total length produces a full original block + empty new block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });

    const right = getBlock(result.state, "p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);

    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });

  it("splits an empty leaf block at offset 0 into two empty siblings", () => {
    // Empty paragraph — pressing Enter on an empty line should produce two empty paragraphs.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 0), allocator);

    const left = getBlock(result.state, "p" as BlockId);
    expect(left?.inlineContent?.items).toEqual([]);

    const right = getBlock(result.state, "p2-0" as BlockId);
    expect(right?.inlineContent?.items).toEqual([]);
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");

    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2-0");
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("three")]) }),
      ],
    });

  it("middle child split: prev sibling's nextSiblingId unchanged; next sibling's prevSiblingId rewired; parent unchanged", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);

    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(getBlock(result.state, "p2" as BlockId)?.nextSiblingId).toBe("p2b-0"); // rewired
    expect(getBlock(result.state, "p2b-0" as BlockId)?.prevSiblingId).toBe("p2");
    expect(getBlock(result.state, "p2b-0" as BlockId)?.nextSiblingId).toBe("p3");
    expect(getBlock(result.state, "p3" as BlockId)?.prevSiblingId).toBe("p2b-0"); // rewired

    // Parent's first/last unchanged (split was a middle child).
    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p3");

    // dirtyIds: { p2, p2b-0, p3 }. Parent NOT dirty (no first/last change).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p2b-0", "p3"]));
  });

  it("first-child split: parent's firstChildId unchanged (still original); next sibling's prevSiblingId rewired", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p1b");
    const result = splitBlockAtPosition(state, createPosition("p1" as BlockId, 1), allocator);

    expect(getBlock(result.state, "p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p1b-0");
    expect(getBlock(result.state, "p1b-0" as BlockId)?.prevSiblingId).toBe("p1");
    expect(getBlock(result.state, "p1b-0" as BlockId)?.nextSiblingId).toBe("p2");
    expect(getBlock(result.state, "p2" as BlockId)?.prevSiblingId).toBe("p1b-0"); // rewired

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p1b-0", "p2"]));
  });

  it("last-child split: parent's lastChildId rewired to new block; no next sibling existed", () => {
    const state = threeChildFixture();
    const allocator = createTestAllocator("p3b");
    const result = splitBlockAtPosition(state, createPosition("p3" as BlockId, 2), allocator);

    expect(getBlock(result.state, "p3" as BlockId)?.nextSiblingId).toBe("p3b-0");
    expect(getBlock(result.state, "p3b-0" as BlockId)?.prevSiblingId).toBe("p3");
    expect(getBlock(result.state, "p3b-0" as BlockId)?.nextSiblingId).toBeNull();

    const parent = getBlock(result.state, "doc" as BlockId);
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
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const allocator = createTestAllocator("pNew");
    const result = splitBlockAtPosition(state, createPosition("p_only" as BlockId, 3), allocator);

    // New block's parent is the section, NOT the doc.
    const right = getBlock(result.state, "pNew-0" as BlockId);
    expect(right?.parentId).toBe("section");

    // Section's child pointers: firstChildId unchanged (still p_only), lastChildId rewired to new block.
    const section = getBlock(result.state, "section" as BlockId);
    expect(section?.firstChildId).toBe("p_only");
    expect(section?.lastChildId).toBe("pNew-0");

    // doc's child pointers untouched.
    const doc = getBlock(result.state, "doc" as BlockId);
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
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const allocator = createTestAllocator("li2");
    const result = splitBlockAtPosition(state, createPosition("li" as BlockId, 3), allocator);

    const right = getBlock(result.state, "li2-0" as BlockId);
    expect(right?.type).toBe("list-item");
    expect(right?.attrs).toEqual({ level: 2, ordered: true });
    expect(right?.parentId).toBe("doc");
  });

  it("new block id comes from allocator.allocate()", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("custom");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator);

    expect(getBlock(result.state, "custom-0" as BlockId) !== null).toBe(true);
    expect(getBlock(result.state, "p" as BlockId)?.nextSiblingId).toBe("custom-0");
  });

  it("preserves structural sharing: untouched blocks retain object identity", () => {
    // doc > [p1, p2, p3] — split p2; p1 should keep identity. (p3 is rewired, so its identity changes.)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("three")]) }),
      ],
    });
    const beforeP1 = getBlock(state, "p1" as BlockId);
    const allocator = createTestAllocator("p2b");
    const result = splitBlockAtPosition(state, createPosition("p2" as BlockId, 1), allocator);
    expect(getBlock(result.state, "p1" as BlockId)).toBe(beforeP1);
  });

  it("preserves immutability (original snapshots and state not mutated; modified block produces a fresh snapshot)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    // Cache pre-op snapshots BEFORE the op so the pre-op State.snapshotCache
    // holds them. (Y.Doc itself is mutated in place; per-State view stability
    // comes from each State's cache, not from Y.Doc immutability.)
    const beforeP = getBlock(state, "p" as BlockId);
    const beforeDoc = getBlock(state, "doc" as BlockId);
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 2), allocator);

    // Original state instance is replaced by a fresh one (fresh snapshot cache).
    expect(result.state).not.toBe(state);
    // Pre-op snapshots are frozen and unchanged.
    expect(beforeP?.inlineContent?.items).toHaveLength(1);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(beforeP?.nextSiblingId).toBeNull();
    // Reading via the pre-op state handle still sees the pre-op snapshots
    // (cached on the input state's snapshot cache, untouched by applyOperation).
    expect(getBlock(state, "p" as BlockId)).toBe(beforeP);
    expect(getBlock(state, "doc" as BlockId)).toBe(beforeDoc);
    // The post-op state sees the new block.
    expect(getBlock(result.state, "p2-0" as BlockId)).not.toBeNull();
    expect(getBlock(result.state, "p" as BlockId)).not.toBe(beforeP);
  });
});

describe("splitBlockAtPosition — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("missing" as BlockId, 0), allocator),
    ).toThrow(/not found/);
  });

  it("throws when the block is a container (firstChildId is set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block has null inlineContent (independent of firstChildId)", () => {
    // A block with inlineContent === null is container-shaped even if firstChildId
    // is also null. The container guard rejects on EITHER condition; this test pins
    // the inlineContent === null arm so a future regression that changes || to &&
    // (or removes the inlineContent check) is caught.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // null inlineContent AND null firstChildId
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block is the root (parentId is null)", () => {
    // Root block, leaf-shaped (atypical but legal — a single-paragraph "document" root).
    const state = buildState({
      rootId: "p",
      blocks: [
        buildBlock({ id: "p", type: "paragraph", parentId: null, inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, 1), allocator),
    ).toThrow(/root/);
  });

  it("throws when offset is negative", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, -1), allocator),
    ).toThrow(/out of range/);
  });

  it("throws when offset exceeds inlineContentLength", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, 999), allocator),
    ).toThrow(/out of range/);
  });

  it("throws when the allocator returns a colliding id (already exists in blocks)", () => {
    // Seed state with a block named "collide-0", then provide an allocator
    // whose first allocation also returns "collide-0". Without the dev-mode
    // collision check, the Y.Map.set for the new split-block would silently
    // overwrite the existing "collide-0" block.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "collide-0" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "collide-0", inlineContent: inlineContent([text("hello world")]) }),
        buildBlock({ id: "collide-0", type: "paragraph", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("collide");
    expect(() =>
      splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator),
    ).toThrow(/allocator returned a colliding id "collide-0"/);
  });
});

describe("splitBlockAtPosition — newBlockInit override (#236)", () => {
  // doc > [h1("Title")] — a heading with a level attr.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "h" }),
        buildBlock({
          id: "h",
          type: "heading",
          attrs: { level: 1 },
          parentId: "doc",
          inlineContent: inlineContent([text("Title")]),
        }),
      ],
    });

  it("new (suffix) block uses the override type + attrs; original is unchanged", () => {
    const state = fixture();
    const allocator = createTestAllocator("n");
    // Split at the END (offset 5): suffix is empty; override it to a paragraph.
    const result = splitBlockAtPosition(
      state,
      createPosition("h" as BlockId, 5),
      allocator,
      { type: "paragraph", attrs: {} },
    );

    // Original keeps its type, attrs, and content.
    const original = getBlock(result.state, "h" as BlockId);
    expect(original?.type).toBe("heading");
    expect(original?.attrs).toEqual({ level: 1 });
    expect(original?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "Title" });

    // New block takes the override — NOT the heading's type/attrs.
    const created = getBlock(result.state, "n-0" as BlockId);
    expect(created?.type).toBe("paragraph");
    expect(created?.attrs).toEqual({});
    expect(created?.inlineContent?.items ?? []).toHaveLength(0);
    expect(created?.parentId).toBe("doc");
    expect(created?.prevSiblingId).toBe("h");
  });

  it("without an override, the new block inherits the original's type + attrs", () => {
    const state = fixture();
    const allocator = createTestAllocator("n");
    const result = splitBlockAtPosition(state, createPosition("h" as BlockId, 5), allocator);
    const created = getBlock(result.state, "n-0" as BlockId);
    expect(created?.type).toBe("heading");
    expect(created?.attrs).toEqual({ level: 1 });
  });
});

describe("splitBlockAtPositionInTx — composability with insertTextInTx", () => {
  // doc > [p("abcdef")]
  // Compose two ops inside ONE applyOperation:
  //   (1) split "abcdef" at offset 3 → original = "abc", new block = "def"
  //   (2) insert "X" at the START of the original block (offset 0)
  //
  // Why offset 0 for step (2): the second `planInsertText` reads `state`,
  // which is the PRE-MUTATION snapshot ("abcdef"). A plan that targets
  // offset 0 picks the leading edge of items[0] = text("abcdef"), and the
  // resulting in-place mutation (itemIndex=0, within=0) on the original
  // block's Y.Text — which the split's inTx has already shortened to
  // "abc" — produces a well-defined result ("Xabc") at any post-split
  // length ≥ 0. If we instead read offset 5 from the pre-mutation
  // snapshot (valid in "abcdef" but past the end of "abc" after the
  // split), the in-place insertion would attempt to write past the
  // shortened Y.Text's end. That is the design limit of plan/inTx: the
  // SECOND plan must target a cursor position the FIRST mutation didn't
  // invalidate. For positions the split DOES affect (e.g., the post-split
  // cursor inside the new block), `replaceRange` is the precedent — its
  // `planInsertTextFullReplace` works against the freshly-merged items
  // array instead of the snapshot.
  it("split + insertText composed in one applyOperation produce one undo entry", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("abcdef")]),
        }),
      ],
    });
    const allocator = createTestAllocator("new");
    const history = createHistory(state);

    // Plan BOTH ops against the same pre-mutation snapshot. The second
    // planInsertText targets offset 0, which is unaffected by the split
    // (see the rationale above the it()).
    const splitPlan = planSplitBlockAtPosition(
      state,
      createPosition("p" as BlockId, 3),
      allocator,
    );
    const insertPlan = planInsertText(
      state,
      createPosition("p" as BlockId, 0),
      "X",
      {},
    );

    const opResult = applyOperation(state, () => {
      splitBlockAtPositionInTx(state[STATE_INTERNAL].doc, splitPlan);
      insertTextInTx(state[STATE_INTERNAL].doc, insertPlan);
    });
    const sel = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 0),
    );
    history.commit(opResult, { before: sel, after: sel });

    // Post-condition: original block carries "X" + the split's prefix; new
    // block carries the split's suffix. Both effects landed in one
    // transaction (one Y.Doc afterTransaction, one undo group).
    const original = getBlock(opResult.state, "p" as BlockId);
    expect(original?.inlineContent?.items).toHaveLength(1);
    expect(original?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "Xabc",
    });
    const newBlock = getBlock(opResult.state, "new-0" as BlockId);
    expect(newBlock?.inlineContent?.items).toHaveLength(1);
    expect(newBlock?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "def",
    });

    // ONE undo entry: a single undo restores the ORIGINAL document.
    expect(history.canUndo()).toBe(true);
    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");

    // After one undo: the original block has its original content; the new
    // block is gone (the split is reversed); the parent's lastChildId is
    // restored to the original block.
    const restored = getBlock(undone.state, "p" as BlockId);
    expect(restored?.inlineContent?.items).toHaveLength(1);
    expect(restored?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "abcdef",
    });
    expect(restored?.nextSiblingId).toBeNull();
    expect(getBlock(undone.state, "new-0" as BlockId)).toBeNull();
    const docBlock = getBlock(undone.state, "doc" as BlockId);
    expect(docBlock?.firstChildId).toBe("p");
    expect(docBlock?.lastChildId).toBe("p");

    // No further undo step: the two ops collapsed into one entry.
    expect(history.canUndo()).toBe(false);
  });
});

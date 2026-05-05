import { describe, it, expect } from "vitest";
import { deleteRange } from "./delete-range";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("deleteRange — basic same-block range delete", () => {
  // doc > [p("hello world")]
  // Delete range [3, 7) — covers "lo w".
  // Expected: p("helorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range from a single text item, keeping prefix and suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helorld" });

    // dirtyIds: only the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

describe("deleteRange — same-block: item shapes and edges", () => {
  it("deletes a range that exactly covers a text item (clean removal at boundary)", () => {
    // [text("hello"), text(" world")] — delete [0, 5) — drops "hello", keeps " world".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello"), text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: " world" });
  });

  it("deletes a range that spans multiple text items, splitting both endpoints", () => {
    // [text("ab"), text("cd"), text("ef")] — delete [1, 5) — keeps "a" + "f".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After run-merging: text("a") and text("f") have same attrs ({}), so they merge.
    expect(items?.[0]).toMatchObject({ text: "af", attrs: {} });
  });

  it("deletes an embed item in the range", () => {
    // [text("a"), embed("img"), text("b")] — delete [1, 2) — drops the embed.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "ab" }); // run-merged at the seam
  });

  it("preserves attrs on both halves when splitting a styled item mid-text", () => {
    // [text("hello world", { bold: true })] — delete [3, 7) drops "lo w" (4 chars)
    // and leaves "hel" + "orld" → run-merged to text("helorld", {bold:true}).
    // Pins the attrs-preservation contract on both prefix and suffix sides.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "helorld", attrs: { bold: true } });
  });

  it("does NOT merge text across an embed at the seam", () => {
    // [text("a", {bold}), embed("img"), text("X"), text("b", {bold})]
    // Delete [2, 3) — drops text("X").
    // Result: [text("a", {bold}), embed, text("b", {bold})] — embed at seam,
    // text("a") and text("b") have same attrs but separated by embed → no merge.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a", { bold: true }),
            embed("img"),
            text("X"),
            text("b", { bold: true }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 3));
    const result = deleteRange(state, span);
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("deleteRange — cross-block (same-parent)", () => {
  it("merges anchor prefix with focus suffix when blocks are adjacent siblings (no intervening)", () => {
    // doc > [p1("hello"), p2(" world")]
    // Delete from p1@2 to p2@3 — keep "he" of p1 + "rld" of p2.
    // Expected: doc > [p1("herld")] — p2 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull(); // p2 deleted; p2 had no nextSibling
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.lastChildId).toBe("p1"); // rewired from p2

    // dirtyIds: { p1, p2, doc } — p2 was last child so doc.lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("deletes intervening leaves between anchor and focus", () => {
    // doc > [p1("hello"), p2("middle"), p3("world")]
    // Delete from p1@2 to p3@2 — anchor=p1, focus=p3, intervening=[p2].
    // Result: p1 keeps "he" + p3's "rld" = "herld"; p2 and p3 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("middle")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull();

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });

  it("middle pair (anchor not first, focus not last): parent unchanged", () => {
    // doc > [p0, p1, p2, p3] — delete from p1@2 to p2@2.
    // Expected: p0 unchanged, p1 absorbs p2 tail, p2 deleted, p3.prevSibling rewires.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("end")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    expect(result.state.blocks.get("p0" as BlockId)?.nextSiblingId).toBe("p1"); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3"); // rewired
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1"); // rewired
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p0"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    // dirtyIds: { p1, p2, p3 } — parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("anchor is first child, focus is last child (full-children-coverage)", () => {
    // doc > [p1, p2] — delete from p1@0 to p2@end (full content of both blocks deleted).
    // Result: p1 has empty inlineContent (anchor.prefix=[] + focus.suffix=[] = []),
    //   p2 deleted, parent.lastChildId rewires to p1.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 1));
    const result = deleteRange(state, span);

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toEqual([]);
    expect(p1?.nextSiblingId).toBeNull();

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("nested: anchor and focus inside a section container; section's lastChildId rewires", () => {
    // doc > section > [p1, p2] — delete from p1@2 to p2@2.
    // After: section has [p1] with merged content; doc untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1"); // rewired from p2

    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "section"]));
  });
});

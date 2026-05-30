import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { insertText, insertTextInTx, planInsertText } from "./insert-text";
import { getBlock } from "../state";
import { getYBlock } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { createPosition } from "../block-position";
import type { BlockId } from "../block-id";

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
          inlineContent: inlineContent([text("hello world")]),
        }),
      ],
    });

  it("inserts the text into the middle of the existing item, preserving attrs", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), " beautiful", {});
    const updated = getBlock(result.state, "p" as BlockId);
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

  it("preserves immutability (original snapshots and state not mutated; modified block produces a fresh snapshot)", () => {
    const state = fixture();
    const beforeP = getBlock(state, "p" as BlockId);
    const beforeDoc = getBlock(state, "doc" as BlockId);
    const result = insertText(state, createPosition("p" as BlockId, 5), " x", {});
    // Original state instance is replaced by a fresh one (fresh snapshot cache).
    expect(result.state).not.toBe(state);
    // The modified block produces a new snapshot.
    expect(getBlock(result.state, "p" as BlockId)).not.toBe(beforeP);
    // Original block snapshot is frozen and unchanged.
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
    // Unmodified blocks (doc) preserve snapshot reference identity across
    // operations via the carry-forward cache in applyOperation — memoized
    // renderers can `prev === next` to skip unchanged subtrees.
    expect(getBlock(result.state, "doc" as BlockId)).toBe(beforeDoc);
  });

  it("normalizes already-unnormalized inline content (merges adjacent same-attrs text items in input)", () => {
    // Input is unnormalized: three adjacent same-attrs text items. The
    // post-pass should merge them all (along with any new insertion).
    // inlineContent() does NOT normalize, so this is a real input shape.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a"), text("b"), text("c")]),
        }),
      ],
    });
    // Insert at offset 1 (between "a" and "b"): all attrs equal, so the result should be one merged item.
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });

  it("merges with the first item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hello ", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", { italic: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "!", attrs: { italic: true } });
  });

  it("merges with the last item when attrs are equal", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 0), "hi", { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("helloworld")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), " ", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 5), "X", { italic: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([text("a", { bold: true }), text("b", { bold: true })]),
        }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", { italic: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 1 = end of "a" / start of embed. Algorithm prefers trailing-edge of text item, so "X" merges with "a".
    const result = insertText(state, createPosition("p" as BlockId, 1), "X", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 2 = end of embed / start of "b". Algorithm puts text BEFORE the next text item; merges with "b" if attrs match.
    const result = insertText(state, createPosition("p" as BlockId, 2), "Y", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
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
          inlineContent: inlineContent([embed("image"), text("b")]),
        }),
      ],
    });
    // offset 0 = before embed.
    const result = insertText(state, createPosition("p" as BlockId, 0), "X", {});
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });
});

describe("insertText — empty text", () => {
  it("returns the original state with empty dirtyIds", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(state, createPosition("p" as BlockId, 2), "", {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });
});

describe("insertText — Y.Text identity preservation (in-place mutation)", () => {
  // When the insertion lands inside (or adjacent to) a text run whose attrs
  // match the incoming attrs, we mutate that run's existing Y.Text in place
  // via yText.insert(...). This preserves per-character CRDT identity across
  // edits — what Yjs is for.
  const getYTextAt = (state: ReturnType<typeof buildState>, blockId: BlockId, itemIndex: number): Y.Text => {
    const yBlock = getYBlock(state[STATE_INTERNAL].doc, blockId, "test");
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yItem = yItems.get(itemIndex);
    return yItem.get("text") as Y.Text;
  };

  it("preserves Y.Text identity when typing into a same-attrs run", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const beforeYText = getYTextAt(state, "p" as BlockId, 0);
    const result = insertText(state, createPosition("p" as BlockId, 3), "X", {});
    const afterYText = getYTextAt(result.state, "p" as BlockId, 0);
    expect(afterYText).toBe(beforeYText);
    expect(afterYText.toString()).toBe("helXlo");
  });

  it("preserves Y.Text identity when typing at end of a same-attrs run (end of content)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const beforeYText = getYTextAt(state, "p" as BlockId, 0);
    const result = insertText(state, createPosition("p" as BlockId, 5), "!", {});
    const afterYText = getYTextAt(result.state, "p" as BlockId, 0);
    expect(afterYText).toBe(beforeYText);
    expect(afterYText.toString()).toBe("hello!");
  });

  it("preserves prev-run Y.Text identity at a text→text boundary when attrs match prev", () => {
    // [text("hello") {}, text("world") {bold:true}]; insert " " {} at offset 5.
    // Trailing-edge preference: insert at the end of the prev text item → mutate the first run.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const beforeYText0 = getYTextAt(state, "p" as BlockId, 0);
    const beforeYText1 = getYTextAt(state, "p" as BlockId, 1);
    const result = insertText(state, createPosition("p" as BlockId, 5), " ", {});
    const afterYText0 = getYTextAt(result.state, "p" as BlockId, 0);
    const afterYText1 = getYTextAt(result.state, "p" as BlockId, 1);
    expect(afterYText0).toBe(beforeYText0);
    expect(afterYText1).toBe(beforeYText1);
    expect(afterYText0.toString()).toBe("hello ");
    expect(afterYText1.toString()).toBe("world");
  });

  it("falls back to full-replace when attrs differ (Y.Text identity not preserved)", () => {
    // Different attrs forces a split: in-place is not possible.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("helloworld")]) }),
      ],
    });
    const beforeYText = getYTextAt(state, "p" as BlockId, 0);
    const result = insertText(state, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    // After fallback the Y.Array is rebuilt; the original Y.Text instance is no longer attached.
    const afterYText0 = getYTextAt(result.state, "p" as BlockId, 0);
    expect(afterYText0).not.toBe(beforeYText);
    // Structural result still correct.
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "BOLD", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });

  it("falls back to full-replace when the block has a pre-existing unnormalized pair elsewhere", () => {
    // [text("a"){}, text("b"){}, embed, text("hello"){italic}]
    // Insert "X" {italic} at offset 4 (inside the last item).
    // Without the full-items normalization scan, the in-place strategy
    // would mutate the last item's Y.Text and leave the
    // [text("a"), text("b")] adjacency intact. The fix: detect the
    // pre-existing adjacent same-attrs pair, bail to the full-replace
    // fallback so mergeAdjacentTextItems normalizes the whole block.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            text("b"),
            { kind: "embed", embedType: "image", attrs: {}, properties: {} },
            text("hello", { italic: true }),
          ]),
        }),
      ],
    });
    const beforeYText = getYTextAt(state, "p" as BlockId, 3);
    const result = insertText(
      state,
      createPosition("p" as BlockId, 4),
      "X",
      { italic: true },
    );
    // Full-replace fallback: original Y.Text identity is lost (rebuilt array).
    const afterItalicYText = getYTextAt(result.state, "p" as BlockId, 2);
    expect(afterItalicYText).not.toBe(beforeYText);
    // Whole-block normalization ran: [text("ab"), embed, text("hXello"){italic}].
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "ab", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "hXello", attrs: { italic: true } });
  });
});

describe("insertText — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => insertText(state, createPosition("missing" as BlockId, 0), "x", {})).toThrow(/not found/);
  });

  it("throws when the block is a container (no inlineContent)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // container, no inlineContent
      ],
    });
    expect(() => insertText(state, createPosition("s" as BlockId, 0), "x", {})).toThrow(/not a leaf/);
  });

  it("throws when offset is negative", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() => insertText(state, createPosition("p" as BlockId, -1), "x", {})).toThrow(/out of range/);
  });

  it("throws when offset exceeds inline-content length", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    // Inline-content length is 2; valid offsets are [0, 2]. Offset 3 is out of range.
    expect(() => insertText(state, createPosition("p" as BlockId, 3), "x", {})).toThrow(/out of range/);
  });
});

describe("insertTextInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hi")]),
        }),
      ],
    });
    const plan = planInsertText(state, createPosition("p" as BlockId, 0), "X", {});
    expect(() => insertTextInTx(state[STATE_INTERNAL].doc, plan)).toThrow(
      /insertText: must be called inside Y\.Doc\.transact/,
    );
  });
});

import { describe, it, expect } from "vitest";
import { insertFootnote } from "./insert-footnote";
import { removeBlock } from "./remove-block";
import { deleteRange } from "./delete-range";
import { clonePastedSubtree } from "../clone-pasted-subtree";
import {
  getBlock,
  getEmbedContent,
  getEmbedContentIds,
} from "../state";
import { inlineContentLength } from "../inline-content";
import {
  assertNoOrphanedEmbedContent,
  assertNoSharedEmbedContent,
} from "../embed-content-cascade";
import { createHistory } from "../history";
import { createPosition, createSpan } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";
import { buildBlock, buildState, inlineContent, text } from "../../test-utils/state-builders";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * `insertFootnote` — the Layer-3 op behind INSERT_FOOTNOTE (FN-7). In ONE
 * transaction it (a) allocates a `footnote-body` CONTAINER body ROOT plus one
 * empty paragraph CHILD into the embedContents map, and (b) inserts a
 * `footnote-anchor` `EmbedItem` at the cursor position in the main-tree leaf,
 * whose `properties.contentBlockId` links to the body root. The container model
 * (mirrors #326 header/footer bodies) lets the body hold multiple paragraphs.
 */
describe("insertFootnote", () => {
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

  it("creates a CONTAINER body root + one empty paragraph child in embedContents", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);

    const body = getEmbedContent(result.state, result.bodyRootId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("footnote-body");
    expect(body?.parentId).toBeNull();
    expect(body?.inlineContent).toBeNull();
    expect(body?.firstChildId).toBe(result.firstParagraphId);
    expect(body?.lastChildId).toBe(result.firstParagraphId);

    const para = getEmbedContent(result.state, result.firstParagraphId);
    expect(para).not.toBeNull();
    expect(para?.type).toBe("paragraph");
    expect(para?.parentId).toBe(result.bodyRootId);
    expect(para?.prevSiblingId).toBeNull();
    expect(para?.nextSiblingId).toBeNull();
    expect(para?.firstChildId).toBeNull();
    expect(para?.lastChildId).toBeNull();
    expect(para?.inlineContent).toEqual({ items: [] });
  });

  it("inserts a footnote-anchor EmbedItem at the position referencing the body root", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);

    const p = getBlock(result.state, "p" as BlockId);
    expect(p).not.toBeNull();
    const items = p?.inlineContent?.items ?? [];
    // The anchor sits at offset 5: "hello" | anchor | " world".
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ kind: "text", text: "hello" });
    const anchor = nth(items, 1, "anchor");
    expect(anchor.kind).toBe("embed");
    if (anchor.kind !== "embed") throw new Error("expected embed");
    expect(anchor.embedType).toBe("footnote-anchor");
    expect(anchor.properties.contentBlockId).toBe(result.bodyRootId);
    expect(anchor.attrs).toEqual({});
    expect(items[2]).toMatchObject({ kind: "text", text: " world" });
    // The anchor counts as exactly one cursor position.
    expect(inlineContentLength({ items })).toBe("hello world".length + 1);
  });

  it("inserts an anchor at offset 0 and at end-of-content", () => {
    const alloc = createTestAllocator("fn");
    const atStart = insertFootnote(fixture(), createPosition("p" as BlockId, 0), alloc);
    const startItems = getBlock(atStart.state, "p" as BlockId)?.inlineContent?.items ?? [];
    expect(nth(startItems, 0, "item").kind).toBe("embed");
    expect(startItems[1]).toMatchObject({ kind: "text", text: "hello world" });

    const atEnd = insertFootnote(
      fixture(),
      createPosition("p" as BlockId, "hello world".length),
      createTestAllocator("fn2"),
    );
    const endItems = getBlock(atEnd.state, "p" as BlockId)?.inlineContent?.items ?? [];
    expect(nth(endItems, endItems.length - 1, "item").kind).toBe("embed");
    expect(endItems[0]).toMatchObject({ kind: "text", text: "hello world" });
  });

  it("dirtyIds covers the body root, the paragraph child, and the anchor's leaf", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);
    expect(result.dirtyIds.has(result.bodyRootId)).toBe(true);
    expect(result.dirtyIds.has(result.firstParagraphId)).toBe(true);
    expect(result.dirtyIds.has("p" as BlockId)).toBe(true);
  });

  it("enumerates exactly the body root (not its child) as an embedContent ROOT", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);
    const rootIds = [...getEmbedContentIds(result.state)];
    expect(rootIds).toContain(result.bodyRootId);
    expect(rootIds).not.toContain(result.firstParagraphId);
    expect(rootIds.length).toBe(1);
  });

  it("upholds the orphan + shared invariants after insert (1:1 anchor↔body)", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);
    expect(() =>
      assertNoOrphanedEmbedContent(result.state, "insertFootnote.test"),
    ).not.toThrow();
    expect(() =>
      assertNoSharedEmbedContent(result.state, "insertFootnote.test"),
    ).not.toThrow();
  });

  it("is atomic: ONE undo restores to before — both anchor AND body gone", () => {
    const state = fixture();
    const history = createHistory(state);
    const alloc = createTestAllocator("fn");
    const sel = createSpan(
      createPosition("p" as BlockId, 5),
      createPosition("p" as BlockId, 5),
    );

    const result = insertFootnote(state, createPosition("p" as BlockId, 5), alloc);
    expect(getEmbedContent(result.state, result.bodyRootId)).not.toBeNull();
    history.commit(result, { before: sel, after: sel });

    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");

    // Anchor gone from the leaf.
    const p = getBlock(undone.state, "p" as BlockId);
    expect(p?.inlineContent?.items).toEqual([{ kind: "text", text: "hello world", attrs: {} }]);
    // Body + its child gone from embedContents.
    expect(getEmbedContent(undone.state, result.bodyRootId)).toBeNull();
    expect(getEmbedContent(undone.state, result.firstParagraphId)).toBeNull();

    // No further undo step: anchor + body collapsed into one entry.
    expect(history.canUndo()).toBe(false);
  });

  it("throws when the position's block does not exist", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    expect(() =>
      insertFootnote(state, createPosition("missing" as BlockId, 0), alloc),
    ).toThrow();
  });

  it("throws when the position's block is not a leaf (no inlineContent)", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    expect(() =>
      insertFootnote(state, createPosition("doc" as BlockId, 0), alloc),
    ).toThrow(/leaf|inlineContent/);
  });

  it("throws when the offset is out of range", () => {
    const state = fixture();
    const alloc = createTestAllocator("fn");
    expect(() =>
      insertFootnote(state, createPosition("p" as BlockId, 999), alloc),
    ).toThrow(/range|offset/);
  });
});

describe("insertFootnote — cascade-delete (regression: existing machinery)", () => {
  it("removing the anchor's containing block cascade-deletes the footnote body", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("anchor here")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("other")]),
        }),
      ],
    });
    const alloc = createTestAllocator("fn");
    const inserted = insertFootnote(state, createPosition("p1" as BlockId, 6), alloc);
    expect(getEmbedContent(inserted.state, inserted.bodyRootId)).not.toBeNull();

    // Remove the block that holds the anchor → body cascade-deletes.
    const removed = removeBlock(inserted.state, "p1" as BlockId);
    expect(getEmbedContent(removed.state, inserted.bodyRootId)).toBeNull();
    expect(getEmbedContent(removed.state, inserted.firstParagraphId)).toBeNull();
    expect(() =>
      assertNoOrphanedEmbedContent(removed.state, "insertFootnote.test"),
    ).not.toThrow();
  });

  it("deleteRange directly over the anchor cascade-deletes the footnote body (primary backspace/delete path)", () => {
    // The deleteRange embed-cascade path (collecting contentBlockId refs from
    // the DELETED inline range) is distinct from removeBlock's whole-block
    // inlineContent walk — this is the path a user hits backspacing over a
    // footnote anchor. Insert the anchor at offset 6 of "anchor here"; the
    // embed occupies exactly 1 offset unit, so [6,7) covers only the anchor.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("anchor here")]),
        }),
      ],
    });
    const alloc = createTestAllocator("fn");
    const inserted = insertFootnote(state, createPosition("p1" as BlockId, 6), alloc);
    expect(getEmbedContent(inserted.state, inserted.bodyRootId)).not.toBeNull();

    const deleted = deleteRange(
      inserted.state,
      createSpan(createPosition("p1" as BlockId, 6), createPosition("p1" as BlockId, 7)),
    );
    // The anchor is gone from the leaf, and its body cascade-deleted.
    const leaf = getBlock(deleted.state, "p1" as BlockId);
    expect(
      leaf?.inlineContent?.items.some(
        (i) => i.kind === "embed" && i.properties.contentBlockId === inserted.bodyRootId,
      ),
    ).toBe(false);
    expect(getEmbedContent(deleted.state, inserted.bodyRootId)).toBeNull();
    expect(getEmbedContent(deleted.state, inserted.firstParagraphId)).toBeNull();
    expect(() =>
      assertNoOrphanedEmbedContent(deleted.state, "insertFootnote.test"),
    ).not.toThrow();
  });
});

describe("insertFootnote — paste duplicates the body (regression: clonePastedSubtree)", () => {
  it("cloning a subtree containing a footnote anchor duplicates the body with a fresh id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("note here")]),
        }),
      ],
    });
    const alloc = createTestAllocator("fn");
    const inserted = insertFootnote(state, createPosition("p" as BlockId, 4), alloc);
    const originalBodyId = inserted.bodyRootId;

    // Clone the anchor-bearing paragraph subtree (the paste source machinery).
    const cloneAlloc = createTestAllocator("clone");
    const cloned = clonePastedSubtree(inserted.state, "p" as BlockId, cloneAlloc);

    // The clone's anchor points at a FRESH body, not the original.
    const clonedAnchor = [...cloned.blocks.values()]
      .flatMap((b) => b.inlineContent?.items ?? [])
      .find((it) => it.kind === "embed" && it.embedType === "footnote-anchor");
    expect(clonedAnchor).toBeDefined();
    if (clonedAnchor === undefined || clonedAnchor.kind !== "embed") {
      throw new Error("expected a cloned footnote anchor");
    }
    const clonedBodyId = clonedAnchor.properties.contentBlockId as BlockId;
    expect(clonedBodyId).not.toBe(originalBodyId);
    // The fresh body subtree is present in the clone's embedContents.
    expect(cloned.embedContents.has(clonedBodyId)).toBe(true);
  });
});

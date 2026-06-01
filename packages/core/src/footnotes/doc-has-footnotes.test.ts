import { describe, it, expect } from "vitest";
import {
  docHasFootnotes,
  insertFootnote,
  removeBlock,
  createTestAllocator,
  createPosition,
  type BlockId,
} from "../state";
import {
  buildBlock,
  buildState,
  inlineContent,
  text,
} from "../test-utils/state-builders";

/**
 * `docHasFootnotes` — the FN-8 O(1) footnote-presence guard. True iff the
 * document holds at least one embed-content body root. Because `embedContents`
 * currently holds exactly footnote bodies (FN-1, 1:1 anchor↔body), this is the
 * "does the doc have any footnote" predicate that lets the render incremental
 * path skip the O(N_blocks) `collectFootnoteAnchors` walk for footnote-free
 * documents (the dominant case).
 *
 * This is the PRIMARY RED-first test: `docHasFootnotes` does not exist until
 * FN-8 adds it, so the import fails (RED) before the helper lands.
 */
describe("docHasFootnotes", () => {
  const footnoteFreeFixture = () =>
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

  it("is false for a freshly-built footnote-free document", () => {
    expect(docHasFootnotes(footnoteFreeFixture())).toBe(false);
  });

  it("is true after inserting a footnote", () => {
    const state = footnoteFreeFixture();
    const result = insertFootnote(
      state,
      createPosition("p" as BlockId, 5),
      createTestAllocator("fn"),
    );
    expect(docHasFootnotes(result.state)).toBe(true);
  });

  it("returns to false after deleting the only footnote", () => {
    const state = footnoteFreeFixture();
    const inserted = insertFootnote(
      state,
      createPosition("p" as BlockId, 5),
      createTestAllocator("fn"),
    );
    expect(docHasFootnotes(inserted.state)).toBe(true);

    // Removing the anchor's containing block cascade-deletes the body root,
    // so the doc has no embed-content roots again.
    const removed = removeBlock(inserted.state, "p" as BlockId);
    expect(docHasFootnotes(removed.state)).toBe(false);
  });

  it("stays true while at least one footnote remains (two footnotes, delete one)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    const first = insertFootnote(
      state,
      createPosition("p1" as BlockId, 5),
      createTestAllocator("fn1"),
    );
    const second = insertFootnote(
      first.state,
      createPosition("p2" as BlockId, 6),
      createTestAllocator("fn2"),
    );
    expect(docHasFootnotes(second.state)).toBe(true);

    // Delete only the first footnote's host block; the second remains.
    const removed = removeBlock(second.state, "p1" as BlockId);
    expect(docHasFootnotes(removed.state)).toBe(true);
  });
});

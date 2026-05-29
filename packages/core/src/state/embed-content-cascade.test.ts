import { describe, it, expect } from "vitest";
import { assertNoOrphanedEmbedContent } from "./embed-content-cascade";
import { applyOperation, freshState, getBlock } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { removeBlock } from "./remove-block";
import { insertText } from "./insert-text";
import {
  buildBlock,
  buildState,
  embed,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import {
  getEmbedContentsMap,
  getBlocksMap,
} from "./yjs-doc";
import type { BlockId } from "./block-id";

describe("assertNoOrphanedEmbedContent", () => {
  describe("happy paths", () => {
    it("no-throw on a state with no EmbedItems at all", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([text("hello")]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw on a valid footnote anchor (EmbedItem -> existing embedContent root)", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              text("hello"),
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw when the EmbedItem has no contentBlockId (inline-data embed)", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              text("a"),
              embed("hard-break", {}),
            ]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw on a valid nested embed (footnote inside a footnote)", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "outer" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "outer",
            type: "fn-body",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "inner" }),
            ]),
          }),
          buildBlock({
            id: "inner",
            type: "fn-body",
            inlineContent: inlineContent([text("deep")]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw on a valid EmbedItem in a templateContents body", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
        templateContents: [
          buildBlock({
            id: "header-1",
            type: "header-template",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "header-fn" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "header-fn",
            type: "fn-body",
            inlineContent: inlineContent([text("h-note")]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test"),
      ).not.toThrow();
    });
  });

  describe("negative paths (synthesized orphans)", () => {
    it("throws when an EmbedItem's contentBlockId references a missing embedContent root", () => {
      // Synthesized orphan: the fixture provides an EmbedItem with
      // `contentBlockId: "missing-id"` and NO matching embedContent root.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "missing-id" }),
            ]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test-op"),
      ).toThrow(/test-op/);
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test-op"),
      ).toThrow(/missing-id/);
      expect(() =>
        assertNoOrphanedEmbedContent(state, "test-op"),
      ).toThrow(/p1/);
    });

    it("throws when a nested EmbedItem (inside an embedContent body) references a missing root", () => {
      // The outer body exists, but its own EmbedItem points at a non-existent
      // inner body.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "outer" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "outer",
            type: "fn-body",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "gone" }),
            ]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "nested-test"),
      ).toThrow(/gone/);
    });

    it("throws when a templateContents body's EmbedItem references a missing root", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
        templateContents: [
          buildBlock({
            id: "header-1",
            type: "header-template",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "missing-header-fn" }),
            ]),
          }),
        ],
      });
      expect(() =>
        assertNoOrphanedEmbedContent(state, "template-test"),
      ).toThrow(/missing-header-fn/);
    });
  });

  describe("integration via real ops", () => {
    it("passes after removeBlock cascade-deletes the embedContent body", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p2",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            nextSiblingId: "p2",
            inlineContent: inlineContent([
              text("anchor"),
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([text("after")]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      // Sanity-check the input has no orphans.
      expect(() =>
        assertNoOrphanedEmbedContent(state, "pre"),
      ).not.toThrow();
      // Remove the anchor block. The cascade helper inside removeBlock should
      // delete the embedContent body, preserving the invariant.
      const result = removeBlock(state, "p1" as BlockId);
      expect(() =>
        assertNoOrphanedEmbedContent(result.state, "post"),
      ).not.toThrow();
    });

    it("passes after a typing op that doesn't touch embeds", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              text("hello"),
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      const result = insertText(
        state,
        { blockId: "p1" as BlockId, offset: 0 },
        "X",
        {},
      );
      expect(() =>
        assertNoOrphanedEmbedContent(result.state, "insertText"),
      ).not.toThrow();
      // Sanity-check the insert landed.
      const p1 = getBlock(result.state, "p1" as BlockId);
      expect(p1?.inlineContent?.items[0]?.kind).toBe("text");
    });
  });

  describe("bypass detection (simulate the failure mode)", () => {
    it("throws when an embedContent root is removed without removing its anchor (via direct call on the bad state)", () => {
      // Simulate a future op that drops the embedContent body but forgets to
      // remove (or rewrite) the EmbedItem anchor. Run the assertion directly
      // (NOT via applyOperation) so we can inspect the bad state's invariant
      // result with full control over the opName threading.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      // Pre-condition: no orphans.
      expect(() =>
        assertNoOrphanedEmbedContent(state, "pre"),
      ).not.toThrow();

      // Bypass the cascade helper: delete the embedContent root directly via
      // a raw Y.Doc transaction. The anchor in p1 is untouched. After the
      // transaction, mint a fresh state so the snapshot cache sees the
      // deletion. (We do NOT go through applyOperation here because
      // applyOperation itself would fire the invariant assertion.)
      const doc = state[STATE_INTERNAL].doc;
      doc.transact(() => {
        const embedContentsMap = getEmbedContentsMap(doc);
        embedContentsMap.delete("fn-body-1");
      });
      // Fresh state with full cache invalidation reflects the bypass write.
      const badState = freshState(state);

      // The invariant must fire on the bad state.
      expect(() =>
        assertNoOrphanedEmbedContent(badState, "bypass-op"),
      ).toThrow(/fn-body-1/);
      expect(() =>
        assertNoOrphanedEmbedContent(badState, "bypass-op"),
      ).toThrow(/bypass-op/);
    });

    it("auto-fires from applyOperation when a transaction would leave the state with an orphan", () => {
      // Wired-in path: applyOperation runs the assertion under isDevMode(),
      // so a bypass transaction throws WITHIN the applyOperation call rather
      // than returning a bad state. This is the real-world catch for future
      // ops that drop EmbedItems without going through the cascade.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p1",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      expect(() =>
        applyOperation(state, () => {
          const embedContentsMap = getEmbedContentsMap(
            state[STATE_INTERNAL].doc,
          );
          embedContentsMap.delete("fn-body-1");
        }),
      ).toThrow(/fn-body-1/);
    });
  });

  describe("cycle defense", () => {
    it("terminates when a sibling chain is malformed with a self-cycle (does not loop forever)", () => {
      // Construct a state then write a sibling self-cycle directly into the
      // Y.Doc, bypassing the higher-level ops' structural invariants. The
      // traversal must terminate via either the visited Set or the step cap
      // and report orphans (or none) without hanging the test.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p2",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            nextSiblingId: "p2",
            inlineContent: inlineContent([text("a")]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([text("b")]),
          }),
        ],
      });
      // Inject a sibling self-cycle: p2.nextSiblingId = p1. The walker
      // visits doc → p1 → p2 → p1 (already visited, terminate).
      const result = applyOperation(state, () => {
        const blocksMap = getBlocksMap(state[STATE_INTERNAL].doc);
        const yp2 = blocksMap.get("p2");
        if (yp2 === undefined) throw new Error("test setup: missing p2");
        yp2.set("nextSiblingId", "p1");
      });
      // Must terminate, not hang. (Vitest's default per-test timeout would
      // catch infinite loops, but the explicit not-hang assertion is the
      // visible contract.)
      expect(() =>
        assertNoOrphanedEmbedContent(result.state, "cycle"),
      ).not.toThrow();
    });
  });
});

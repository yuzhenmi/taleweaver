import { describe, it, expect } from "vitest";
import {
  assertNoOrphanedEmbedContent,
  assertNoSharedEmbedContent,
} from "./embed-content-cascade";
import { applyOperation, freshStateFromDoc, getBlock } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { removeBlock } from "./ops/remove-block";
import { insertText } from "./ops/insert-text";
import { clonePastedSubtree } from "./clone-pasted-subtree";
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
  runTransaction,
} from "./yjs-doc";
import type { BlockId } from "./block-id";
import { createTestAllocator } from "./block-id";

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
      const badState = freshStateFromDoc(state);

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
      //
      // Use direct Y.Doc surgery (runTransaction + freshStateFromDoc), NOT
      // applyOperation — applyOperation's dev-mode assertChainIntegrity would
      // (correctly) reject this deliberately-malformed chain before the test
      // could exercise the cascade walker's own cycle defense. freshStateFromDoc
      // is the documented escape hatch for untracked external surgery.
      runTransaction(state[STATE_INTERNAL].doc, () => {
        const blocksMap = getBlocksMap(state[STATE_INTERNAL].doc);
        const yp2 = blocksMap.get("p2");
        if (yp2 === undefined) throw new Error("test setup: missing p2");
        yp2.set("nextSiblingId", "p1");
      });
      const badState = freshStateFromDoc(state);
      // Must terminate, not hang. (Vitest's default per-test timeout would
      // catch infinite loops, but the explicit not-hang assertion is the
      // visible contract.)
      expect(() =>
        assertNoOrphanedEmbedContent(badState, "cycle"),
      ).not.toThrow();
    });
  });
});

describe("assertNoSharedEmbedContent", () => {
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
        assertNoSharedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw on a valid 1:1 anchor->body state (single anchor owns its body)", () => {
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
              text("first"),
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([
              text("second"),
              embed("fn-anchor", { contentBlockId: "fn-body-2" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note one")]),
          }),
          buildBlock({
            id: "fn-body-2",
            type: "fn-body",
            inlineContent: inlineContent([text("note two")]),
          }),
        ],
      });
      expect(() =>
        assertNoSharedEmbedContent(state, "test"),
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
              text("b"),
              embed("hard-break", {}),
            ]),
          }),
        ],
      });
      expect(() =>
        assertNoSharedEmbedContent(state, "test"),
      ).not.toThrow();
    });

    it("no-throw on a valid nested embed (distinct bodies at each level)", () => {
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
        assertNoSharedEmbedContent(state, "test"),
      ).not.toThrow();
    });
  });

  describe("negative paths (synthesized shared bodies)", () => {
    it("throws naming both owning blocks + the contentBlockId when two anchors in different blocks share one body", () => {
      // Synthesized corruption: two EmbedItems in DIFFERENT blocks point at the
      // SAME contentBlockId, which has exactly one real embedContent root. This
      // bypasses the production path (clonePastedSubtree remaps on paste), so we
      // construct the bad state directly via the builder.
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
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "shared",
            type: "fn-body",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
      });
      expect(() =>
        assertNoSharedEmbedContent(state, "share-op"),
      ).toThrow(/share-op/);
      expect(() =>
        assertNoSharedEmbedContent(state, "share-op"),
      ).toThrow(/shared/);
      expect(() =>
        assertNoSharedEmbedContent(state, "share-op"),
      ).toThrow(/p1/);
      expect(() =>
        assertNoSharedEmbedContent(state, "share-op"),
      ).toThrow(/p2/);
    });

    it("throws when two anchors WITHIN the same block share one body", () => {
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
              embed("fn-anchor", { contentBlockId: "shared" }),
              text(" and "),
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "shared",
            type: "fn-body",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
      });
      expect(() =>
        assertNoSharedEmbedContent(state, "same-block-op"),
      ).toThrow(/same-block-op/);
      expect(() =>
        assertNoSharedEmbedContent(state, "same-block-op"),
      ).toThrow(/shared/);
      expect(() =>
        assertNoSharedEmbedContent(state, "same-block-op"),
      ).toThrow(/p1/);
    });

    it("throws when a body is shared across a body-tree anchor and a main-tree anchor", () => {
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
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "outer",
            type: "fn-body",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
          buildBlock({
            id: "shared",
            type: "fn-body",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
      });
      expect(() =>
        assertNoSharedEmbedContent(state, "cross-tree-op"),
      ).toThrow(/cross-tree-op/);
      expect(() =>
        assertNoSharedEmbedContent(state, "cross-tree-op"),
      ).toThrow(/shared/);
      // Both owning blocks named: the main-tree anchor (p1) and the
      // body-tree anchor (outer).
      expect(() =>
        assertNoSharedEmbedContent(state, "cross-tree-op"),
      ).toThrow(/p1/);
      expect(() =>
        assertNoSharedEmbedContent(state, "cross-tree-op"),
      ).toThrow(/outer/);
    });
  });

  describe("integration via real paste (clonePastedSubtree)", () => {
    it("a pasted anchor gets its own distinct body — no sharing after paste", () => {
      // Source doc: a paragraph holding a footnote anchor that references a
      // body. clonePastedSubtree is the op that runs on paste; it must remap
      // the cloned anchor's contentBlockId to a freshly-cloned body. A combined
      // state holding BOTH the original and the clone must therefore be
      // sharing-free. If clonePastedSubtree had a hole, this test would throw.
      const sourceState = buildState({
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
              text("anchor"),
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

      const allocator = createTestAllocator("paste");
      const cloned = clonePastedSubtree(
        sourceState,
        "p1" as BlockId,
        allocator,
      );

      // The cloned anchor must reference a DISTINCT, freshly-cloned body.
      const clonedRoot = cloned.blocks.get(cloned.rootId);
      expect(clonedRoot).toBeDefined();
      const clonedEmbed = clonedRoot?.inlineContent?.items.find(
        (item) => item.kind === "embed",
      );
      expect(clonedEmbed?.kind).toBe("embed");
      const clonedCbId =
        clonedEmbed?.kind === "embed"
          ? clonedEmbed.properties.contentBlockId
          : undefined;
      expect(typeof clonedCbId).toBe("string");
      expect(clonedCbId).not.toBe("fn-body-1");
      // The fresh body lives in the clone's embedContents map.
      expect(cloned.embedContents.has(clonedCbId as BlockId)).toBe(true);

      // Build a combined state holding original + clone, both anchors and both
      // bodies, and confirm the sharing invariant is satisfied.
      const clonedRootId = cloned.rootId;
      const combined = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p1",
            lastChildId: "p-clone",
          }),
          buildBlock({
            id: "p1",
            type: "paragraph",
            parentId: "doc",
            nextSiblingId: "p-clone",
            inlineContent: inlineContent([
              text("anchor"),
              embed("fn-anchor", { contentBlockId: "fn-body-1" }),
            ]),
          }),
          buildBlock({
            id: "p-clone",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([
              text("anchor"),
              embed("fn-anchor", { contentBlockId: clonedCbId as string }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "fn-body-1",
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
          buildBlock({
            id: clonedCbId as string,
            type: "fn-body",
            inlineContent: inlineContent([text("note")]),
          }),
        ],
      });
      // Silence unused-var lint on clonedRootId while keeping the assertion
      // that the clone has a stable root identity.
      expect(clonedRootId).toBe(cloned.rootId);

      expect(() =>
        assertNoSharedEmbedContent(combined, "paste"),
      ).not.toThrow();
    });
  });

  describe("scope-down (dirtyIds fast path)", () => {
    it("a plain insertText op (no embed in the dirty block) does not throw and leaves a separate valid embed untouched", () => {
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
            inlineContent: inlineContent([text("plain")]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([
              text("has-embed"),
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
      // insertText dirties p1 only — p1 carries no embed-with-contentBlockId, so
      // the sharing check's scope-down skips the full sweep. It must not throw,
      // and the unrelated valid embed in p2 stays intact.
      const result = insertText(
        state,
        { blockId: "p1" as BlockId, offset: 0 },
        "X",
        {},
      );
      expect(() =>
        assertNoSharedEmbedContent(result.state, "insertText", result.dirtyIds),
      ).not.toThrow();
      const p2 = getBlock(result.state, "p2" as BlockId);
      const embedItem = p2?.inlineContent?.items.find(
        (item) => item.kind === "embed",
      );
      expect(embedItem?.kind).toBe("embed");
      if (embedItem?.kind === "embed") {
        expect(embedItem.properties.contentBlockId).toBe("fn-body-1");
      }
    });

    it("passes when the op IS embed-touching but introduces no duplicate (full sweep path, clean)", () => {
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
      // Pass the dirty set as p1 (which DOES carry an embed) so the scope-down
      // takes the full-sweep branch; the state is sharing-free, so no throw.
      expect(() =>
        assertNoSharedEmbedContent(
          state,
          "embed-touching",
          new Set<BlockId>(["p1" as BlockId]),
        ),
      ).not.toThrow();
    });

    it("fires from the full sweep even via the dirtyIds path when a dirty block introduces a duplicate", () => {
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
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
          buildBlock({
            id: "p2",
            type: "paragraph",
            parentId: "doc",
            prevSiblingId: "p1",
            inlineContent: inlineContent([
              embed("fn-anchor", { contentBlockId: "shared" }),
            ]),
          }),
        ],
        embedContents: [
          buildBlock({
            id: "shared",
            type: "fn-body",
            inlineContent: inlineContent([text("body")]),
          }),
        ],
      });
      // p2 is the "dirty" block that introduced the duplicate ref; it carries an
      // embed-with-contentBlockId, so the scope-down runs the full sweep and the
      // duplicate is caught.
      expect(() =>
        assertNoSharedEmbedContent(
          state,
          "dup-op",
          new Set<BlockId>(["p2" as BlockId]),
        ),
      ).toThrow(/shared/);
    });
  });
});

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createYDoc,
  getListDefsMap,
  getCommentsMap,
  getMetaMap,
  allTreeBlockCount,
  getYBlock,
  runTransaction,
  requireInTransaction,
  dirtyIdsFromTransaction,
} from "./yjs-doc";
import { getBlock } from "./state";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { createTestAllocator } from "./block-id";
import { buildFlowDoc, finalSectionOf, withTestAttrs } from "../test-utils/state-builders";
import { getRegistry } from "./registry";
import type { BlockId } from "./block-id";
import { createPosition } from "./block-position";
import { STATE_INTERNAL } from "./state-internal";
import { insertText } from "./ops/insert-text";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { removeBlock } from "./ops/remove-block";
import { applyAttrsToRange } from "./ops/apply-attrs";
import { createSpan } from "./block-position";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";

const id = (s: string) => s as BlockId;

/** A document `doc` with paragraphs p1, p2 and a header body `hdr` > `hp`. */
function fixture() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("two")]) }),
    ],
    templateContents: [
      buildBlock({ id: "hdr", type: "header-body", firstChildId: "hp", lastChildId: "hp" }),
      buildBlock({ id: "hp", type: "paragraph", parentId: "hdr", inlineContent: inlineContent([text("hello")]) }),
    ],
  });
}

describe("yjs-doc", () => {
  describe("createYDoc", () => {
    it("creates a Y.Doc with the registry, listDefs, comments and meta maps", () => {
      const doc = createYDoc();
      expect(getRegistry(doc)).toBeInstanceOf(Y.Map);
      expect(getListDefsMap(doc)).toBeInstanceOf(Y.Map);
      expect(getCommentsMap(doc)).toBeInstanceOf(Y.Map);
      expect(getMetaMap(doc)).toBeInstanceOf(Y.Map);
    });

    it("seeds meta.rootId when provided", () => {
      const doc = createYDoc({ rootId: "root-1" as BlockId });
      expect(getMetaMap(doc).get("rootId")).toBe("root-1");
    });

    it("leaves meta.rootId unset when not provided", () => {
      const doc = createYDoc();
      expect(getMetaMap(doc).get("rootId")).toBeUndefined();
    });

    it("seeds the comments side-table map (empty)", () => {
      const doc = createYDoc();
      const comments = getCommentsMap(doc);
      expect(comments).toBeInstanceOf(Y.Map);
      expect(comments.size).toBe(0);
    });

    it("does NOT count side-table entries as blocks (allTreeBlockCount unchanged)", () => {
      const doc = createYDoc();
      getCommentsMap(doc).set("c1", new Y.Map());
      getListDefsMap(doc).set("l1", new Y.Map());
      expect(allTreeBlockCount(doc)).toBe(0);
    });
  });

  describe("allTreeBlockCount", () => {
    it("counts the registry entries of every tree", () => {
      // doc + p1 + p2 + hdr + hp.
      // doc + its final section + p1 + p2, hdr + hp.
      expect(allTreeBlockCount(fixture()[STATE_INTERNAL].doc)).toBe(6);
    });
  });

  describe("runTransaction", () => {
    it("executes the callback inside a Y.Doc transaction (mutations visible afterward)", () => {
      const doc = createYDoc();
      let called = false;
      runTransaction(doc, () => {
        called = true;
        getListDefsMap(doc).set("test", new Y.Map());
      });
      expect(called).toBe(true);
      expect(getListDefsMap(doc).has("test")).toBe(true);
    });

    it("throws (dev) when called reentrantly inside another transaction", () => {
      // Nested runTransaction silently loses dirtyIds (the inner
      // afterTransaction listener detaches before the outer commit) → invisible
      // stale paint. The dev-mode guard turns that footgun into a loud throw.
      const doc = createYDoc();
      expect(() =>
        runTransaction(doc, () => {
          runTransaction(doc, () => {
            getListDefsMap(doc).set("inner", new Y.Map());
          });
        }),
      ).toThrow(/already inside a Y\.Doc transaction/);
      // The guard throws BEFORE doc.transact, so the inner write never lands.
      expect(getListDefsMap(doc).has("inner")).toBe(false);
    });

    it("reports a text edit as the edited block's dirtyId", () => {
      const r = insertText(fixture(), createPosition(id("p2"), 1), "X", {});
      expect(r.dirtyIds.has(id("p2"))).toBe(true);
      expect(r.dirtyIds.has(id("p1"))).toBe(false);
    });

    it("reports a block-attr write as that block's dirtyId", () => {
      const r = setBlockAttrs(fixture(), id("p1"), { textAlign: "center" });
      expect(r.dirtyIds.has(id("p1"))).toBe(true);
    });

    it("reports a FORMAT-only edit inside a template body as the edited block's dirtyId", () => {
      const r = applyAttrsToRange(fixture(), createSpan(createPosition(id("hp"), 1), createPosition(id("hp"), 4)), { bold: true });
      expect(r.dirtyIds.has(id("hp"))).toBe(true);
    });

    it("reports a block removal as the removed block's dirtyId", () => {
      const r = removeBlock(fixture(), id("p2"));
      expect(r.dirtyIds.has(id("p2"))).toBe(true);
    });
  });

  // candidates are derived structurally, then compared exactly —
  // only ids whose read-model record changed are dirty; untouched blocks keep their snapshot.
  describe("dirty sets are exact", () => {
    const four = () => buildFlowDoc([{ p: "p0", t: "zero" }, { p: "p1", t: "one" }, { p: "p2", t: "two" }, { p: "p3", t: "three" }]);
    const ids = (s: ReadonlySet<BlockId>) => [...s].sort();

    it("a local keystroke dirties exactly its owner (mid and at the end of the paragraph)", () => {
      expect(ids(insertText(four(), createPosition(id("p1"), 1), "X", {}).dirtyIds)).toEqual(["p1"]);
      expect(ids(insertText(four(), createPosition(id("p1"), 3), "X", {}).dirtyIds)).toEqual(["p1"]);
    });

    it("a remote keystroke dirties exactly its owner", () => {
      const a = four();
      const b = new Y.Doc();
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a[STATE_INTERNAL].doc));
      const seen: string[][] = [];
      b.on("afterTransaction", (tx: Y.Transaction) => seen.push(ids(dirtyIdsFromTransaction(b, tx))));
      const typed = insertText(a, createPosition(id("p2"), 2), "X", {}).state;
      Y.applyUpdate(b, Y.encodeStateAsUpdate(typed[STATE_INTERNAL].doc, Y.encodeStateVector(b)), "remote");
      expect(seen).toEqual([["p2"]]);
    });

    it("Enter dirties the head, the tail and only the neighbours whose links changed", () => {
      const mid = splitBlockAtPosition(four(), createPosition(id("p1"), 1), createTestAllocator("h"));
      expect(ids(mid.dirtyIds)).toEqual(["h-0", "p0", "p1"]);
      const first = four();
      const F = finalSectionOf(first);
      const top = splitBlockAtPosition(first, createPosition(id("p0"), 2), createTestAllocator("h"));
      expect(ids(top.dirtyIds)).toEqual(["h-0", "p0", F].sort());
      const end = splitBlockAtPosition(four(), createPosition(id("p3"), 5), createTestAllocator("h"));
      expect(ids(end.dirtyIds)).toEqual(["h-0", "p2", "p3"]);
    });

    it("Backspace-merge dirties the vanished paragraph, the survivor and the relinked neighbour", () => {
      const r = mergeAdjacentBlocks(four(), id("p1"), id("p2"));
      expect(ids(r.dirtyIds)).toEqual(["p0", "p1", "p2"]);
    });

    it("a ¶-key write (formatting exactly the ¶) dirties exactly its owner", () => {
      const r = applyAttrsToRange(withTestAttrs(four()), createSpan(createPosition(id("p1"), 3), createPosition(id("p2"), 0)), { italic: true });
      expect(getBlock(r.state, id("p1"))?.markAttrs).toEqual({ italic: true });
      expect(ids(r.dirtyIds)).toEqual(["p1"]);
    });
  });

  describe("getYBlock", () => {
    it("returns the block's registry entry", () => {
      const doc = fixture()[STATE_INTERNAL].doc;
      doc.transact(() => {
        const entry = getYBlock(doc, id("p1"), "test");
        expect(entry).toBe(getRegistry(doc).get("p1"));
        expect(entry.get("type")).toBe("paragraph");
      });
    });

    it("returns template-body entries from the same registry", () => {
      const doc = fixture()[STATE_INTERNAL].doc;
      doc.transact(() => {
        expect(getYBlock(doc, id("hp"), "test").get("type")).toBe("paragraph");
      });
    });

    it("throws with op name when the id is missing", () => {
      const doc = createYDoc();
      expect(() => doc.transact(() => getYBlock(doc, "missing" as BlockId, "myOp"))).toThrow(
        /myOp: block "missing" disappeared mid-transaction/,
      );
    });
  });

  describe("requireInTransaction", () => {
    it("throws with opName when called outside any transaction", () => {
      const doc = createYDoc();
      expect(() => requireInTransaction(doc, "myOp")).toThrow(
        /myOp: must be called inside Y\.Doc\.transact/,
      );
    });

    it("does not throw inside doc.transact", () => {
      const doc = createYDoc();
      expect(() => {
        doc.transact(() => {
          requireInTransaction(doc, "myOp");
        });
      }).not.toThrow();
    });

    it("does not throw inside runTransaction", () => {
      const doc = createYDoc();
      expect(() => {
        runTransaction(doc, () => {
          requireInTransaction(doc, "myOp");
        });
      }).not.toThrow();
    });

    it("does not throw inside Y.UndoManager.undo (defensive)", () => {
      // Y.UndoManager opens its own internal doc.transact for the inverse op,
      // so `requireInTransaction` should pass when an *InTx helper is
      // (hypothetically) reached from inside the undo reversal context.
      const doc = createYDoc();
      const scope = getListDefsMap(doc);
      const undoManager = new Y.UndoManager(scope, { trackedOrigins: new Set([null]) });

      // Make a tracked change so the undo manager has something to undo.
      doc.transact(() => {
        scope.set("l1", new Y.Map());
      });

      let observedTxInside = false;
      const listener = (_tx: Y.Transaction) => {
        // While the undo runs Yjs has an open transaction → the assert passes.
        if (!observedTxInside) {
          try {
            requireInTransaction(doc, "fromUndo");
            observedTxInside = true;
          } catch {
            observedTxInside = false;
          }
        }
      };
      doc.on("beforeTransaction", listener);
      try {
        undoManager.undo();
      } finally {
        doc.off("beforeTransaction", listener);
      }
      expect(observedTxInside).toBe(true);
    });

    it("throws again after the transaction returns", () => {
      const doc = createYDoc();
      runTransaction(doc, () => {
        requireInTransaction(doc, "myOp");
      });
      expect(() => requireInTransaction(doc, "myOp")).toThrow(
        /myOp: must be called inside Y\.Doc\.transact/,
      );
    });
  });
});

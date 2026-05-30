import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import {
  getEmbedContentRootIds,
  getTemplateContentRootIds,
  __resetRootIdRecomputesForTest,
  __getRootIdRecomputesForTest,
} from "./root-id-cache";
import {
  getEmbedContentIds,
  getTemplateContentIds,
  applyOperation,
} from "./state";
import { insertText } from "./ops/insert-text";
import { createPosition } from "./block-position";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import {
  getEmbedContentsMap,
  getTemplateContentsMap,
} from "./yjs-doc";
import { buildYBlock } from "./y-block";
import { STATE_INTERNAL } from "./state-internal";
import type { BlockId } from "./block-id";

/**
 * Build a body-block Y.Map fixture (footnote / header body) for direct
 * insertion into a tree map in tests.
 */
function ybody(args: {
  type: string;
  parentId?: string | null;
  inlineText?: string;
}): Y.Map<unknown> {
  return buildYBlock({
    type: args.type,
    attrs: {},
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: null,
    nextSiblingId: null,
    firstChildId: null,
    lastChildId: null,
    inlineContent:
      args.inlineText === undefined
        ? null
        : { items: [text(args.inlineText)] },
  });
}

describe("root-id-cache: #313 root-only contract preserved", () => {
  it("getEmbedContentIds yields ONLY the root of a multi-level embed body", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "emb-root",
          type: "body-container",
          firstChildId: "c1",
          lastChildId: "c2",
        }),
        buildBlock({
          id: "c1",
          type: "paragraph",
          parentId: "emb-root",
          nextSiblingId: "c2",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "c2",
          type: "paragraph",
          parentId: "emb-root",
          prevSiblingId: "c1",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    expect(Array.from(getEmbedContentIds(state))).toEqual(["emb-root"]);
  });

  it("getTemplateContentIds yields ONLY the root of a multi-level template body", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({
          id: "tpl-root",
          type: "header-body",
          firstChildId: "h1",
          lastChildId: "h2",
        }),
        buildBlock({
          id: "h1",
          type: "paragraph",
          parentId: "tpl-root",
          nextSiblingId: "h2",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "h2",
          type: "paragraph",
          parentId: "tpl-root",
          prevSiblingId: "h1",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    expect(Array.from(getTemplateContentIds(state))).toEqual(["tpl-root"]);
  });

  it("yields a single-level leaf root and an empty set when empty", () => {
    const leaf = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-leaf", type: "paragraph", inlineContent: inlineContent([text("x")]) }),
      ],
    });
    expect(Array.from(getEmbedContentIds(leaf))).toEqual(["fn-leaf"]);

    const empty = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(Array.from(getEmbedContentIds(empty))).toEqual([]);
    expect(Array.from(getTemplateContentIds(empty))).toEqual([]);
  });

  it("yields both roots when two sibling roots exist", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "fn-2", type: "paragraph", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    expect(Array.from(getEmbedContentRootIds(state[STATE_INTERNAL].doc)).sort()).toEqual([
      "fn-1",
      "fn-2",
    ]);
  });
});

describe("root-id-cache: invalidation across add/remove", () => {
  it("includes a newly added root and drops a removed root (embed)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    // Prime the cache (lazy attach + initial scan).
    expect(Array.from(getEmbedContentRootIds(doc)).sort()).toEqual(["fn-1"]);

    // Add a second root.
    doc.transact(() => {
      getEmbedContentsMap(doc).set("fn-2", ybody({ type: "paragraph", inlineText: "b" }));
    });
    expect(Array.from(getEmbedContentRootIds(doc)).sort()).toEqual(["fn-1", "fn-2"]);

    // Remove the first root.
    doc.transact(() => {
      getEmbedContentsMap(doc).delete("fn-1");
    });
    expect(Array.from(getEmbedContentRootIds(doc)).sort()).toEqual(["fn-2"]);
  });

  it("includes a newly added root and drops a removed root (template)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({ id: "tpl-1", type: "header-body", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    expect(Array.from(getTemplateContentRootIds(doc)).sort()).toEqual(["tpl-1"]);

    doc.transact(() => {
      getTemplateContentsMap(doc).set("tpl-2", ybody({ type: "header-body", inlineText: "b" }));
    });
    expect(Array.from(getTemplateContentRootIds(doc)).sort()).toEqual(["tpl-1", "tpl-2"]);

    doc.transact(() => {
      getTemplateContentsMap(doc).delete("tpl-1");
    });
    expect(Array.from(getTemplateContentRootIds(doc)).sort()).toEqual(["tpl-2"]);
  });

  it("excludes a non-root child added to the map (parentId !== null)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-root", type: "body-container" }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    expect(Array.from(getEmbedContentRootIds(doc)).sort()).toEqual(["fn-root"]);

    // A body child (parentId points at the root) is registered in the same
    // map; the accessor must still yield ONLY the root.
    doc.transact(() => {
      getEmbedContentsMap(doc).set(
        "fn-child",
        ybody({ type: "paragraph", parentId: "fn-root", inlineText: "child" }),
      );
    });
    expect(Array.from(getEmbedContentRootIds(doc)).sort()).toEqual(["fn-root"]);
  });
});

describe("root-id-cache: invalidation across UNDO/REDO (Yjs surgery path)", () => {
  // The load-bearing correctness test. UndoManager.undo()/.redo() re-add /
  // re-delete map keys via pure Yjs surgery that bypasses ALL op code. The
  // flat Y.Map.observe handler must still fire inside the UndoManager's
  // internal transaction so the cache stays correct — an op-hook would miss
  // this and silently stale the cache.
  it("reflects a resurrected embed root after undo, and re-removal after redo", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    const yEmbeds = getEmbedContentsMap(doc);

    // Prime the cache before any UndoManager activity.
    expect(Array.from(getEmbedContentRootIds(doc))).toEqual(["fn-1"]);

    const undoManager = new Y.UndoManager([yEmbeds], {
      captureTimeout: Number.MAX_SAFE_INTEGER,
      trackedOrigins: new Set([null]),
    });

    // Delete the root (tracked).
    doc.transact(() => {
      yEmbeds.delete("fn-1");
    });
    undoManager.stopCapturing();
    expect(Array.from(getEmbedContentRootIds(doc))).toEqual([]);

    // UNDO resurrects the root via Yjs surgery (no op code runs).
    undoManager.undo();
    expect(Array.from(getEmbedContentRootIds(doc))).toEqual(["fn-1"]);

    // REDO re-deletes it.
    undoManager.redo();
    expect(Array.from(getEmbedContentRootIds(doc))).toEqual([]);
  });

  it("reflects a resurrected template root after undo", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({ id: "tpl-1", type: "header-body", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    const yTemplates = getTemplateContentsMap(doc);
    expect(Array.from(getTemplateContentRootIds(doc))).toEqual(["tpl-1"]);

    const undoManager = new Y.UndoManager([yTemplates], {
      captureTimeout: Number.MAX_SAFE_INTEGER,
      trackedOrigins: new Set([null]),
    });
    doc.transact(() => {
      yTemplates.delete("tpl-1");
    });
    undoManager.stopCapturing();
    expect(Array.from(getTemplateContentRootIds(doc))).toEqual([]);

    undoManager.undo();
    expect(Array.from(getTemplateContentRootIds(doc))).toEqual(["tpl-1"]);
  });
});

describe("root-id-cache: recompute-counter (perf shape)", () => {
  beforeEach(() => {
    __resetRootIdRecomputesForTest();
  });

  it("N main-tree keystrokes trigger 0 embed/template root-set recomputes", () => {
    let state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "root",
          inlineContent: inlineContent([text("hi")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
      ],
      templateContents: [
        buildBlock({ id: "tpl-1", type: "header-body", inlineContent: inlineContent([text("h")]) }),
      ],
    });

    // Prime both caches (initial scan happens inside getHolder, NOT via the
    // recompute counter — the counter only counts stale-triggered rescans).
    void Array.from(getEmbedContentIds(state));
    void Array.from(getTemplateContentIds(state));
    __resetRootIdRecomputesForTest();

    // Simulate 5 keystrokes into the MAIN tree, calling both accessors each
    // time (mirroring render.ts calling both on every render).
    for (let i = 0; i < 5; i++) {
      const r = insertText(state, createPosition("p1" as BlockId, 2 + i), "x", {});
      state = r.state;
      void Array.from(getEmbedContentIds(state));
      void Array.from(getTemplateContentIds(state));
    }

    expect(__getRootIdRecomputesForTest()).toBe(0);
  });

  it("editing an embed BODY's text (not key-set) triggers 0 recomputes", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    void Array.from(getEmbedContentRootIds(doc));
    __resetRootIdRecomputesForTest();

    // Mutate a NESTED value inside the body block (not the map key-set). With
    // a flat `observe` (not observeDeep), this must NOT flag staleness.
    applyOperation(state, () => {
      const body = getEmbedContentsMap(doc).get("fn-1");
      if (body === undefined) throw new Error("fn-1 missing");
      body.set("type", "paragraph-edited");
    });
    void Array.from(getEmbedContentRootIds(doc));

    expect(__getRootIdRecomputesForTest()).toBe(0);
  });

  it("exactly ONE root add triggers exactly ONE recompute of that map's set", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({ id: "fn-1", type: "paragraph", inlineContent: inlineContent([text("a")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    void Array.from(getEmbedContentRootIds(doc));
    __resetRootIdRecomputesForTest();

    doc.transact(() => {
      getEmbedContentsMap(doc).set("fn-2", ybody({ type: "paragraph", inlineText: "b" }));
    });
    // First read after the add recomputes once.
    void Array.from(getEmbedContentRootIds(doc));
    // Subsequent reads with no further key-set change recompute 0 more times.
    void Array.from(getEmbedContentRootIds(doc));
    void Array.from(getEmbedContentRootIds(doc));

    expect(__getRootIdRecomputesForTest()).toBe(1);
  });

  it("exactly ONE root remove triggers exactly ONE recompute of that map's set", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({ id: "tpl-1", type: "header-body", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "tpl-2", type: "header-body", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const doc = state[STATE_INTERNAL].doc;
    void Array.from(getTemplateContentRootIds(doc));
    __resetRootIdRecomputesForTest();

    doc.transact(() => {
      getTemplateContentsMap(doc).delete("tpl-1");
    });
    void Array.from(getTemplateContentRootIds(doc));
    void Array.from(getTemplateContentRootIds(doc));

    expect(__getRootIdRecomputesForTest()).toBe(1);
  });
});

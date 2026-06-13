/**
 * Barrel contract test for `state/index.ts`.
 *
 * Proves the barrel compiles and surfaces a representative symbol from each
 * layer (types/access, utilities, ops, history, boot), and — critically —
 * that the state-module-private `STATE_INTERNAL` symbol plus the internal
 * write-list / clone machinery are NOT reachable through the barrel (the Yjs
 * encapsulation and the public-op surface must not leak).
 */
import { describe, expect, it } from "vitest";

// Namespace import: lets us assert the absence of infra symbols by inspecting
// the barrel's own export keys.
import * as barrel from "./index";
// The state-module-private encapsulation symbol — imported here (legal from
// inside state/) so the test can prove its VALUE never leaks through the
// barrel, not merely that no export is named "STATE_INTERNAL".
import { STATE_INTERNAL } from "./state-internal";

// Representative named imports through the barrel — one per layer. If any of
// these were missing from the barrel this file would fail to compile.
import {
  // Layer 1 — types & access primitives
  createState,
  getBlock,
  createPosition,
  createSpan,
  mergeAdjacentTextItems,
  attrsEqual,
  createTestAllocator,
  // Layer 2 — pure utilities
  nextBlockInDocOrder,
  compareBlocksInDocOrder,
  iterateSpan,
  extractText,
  // Layer 3 — ops
  insertText,
  deleteRange,
  splitBlockAtPosition,
  setBlockType,
  reparentChildren,
  applySectionBreak,
  // History
  createHistory,
  History,
  // Boot
  createEmptyDocument,
} from "./index";

describe("state/index barrel — layer surface", () => {
  it("surfaces Layer 1 types & access primitives", () => {
    expect(typeof createState).toBe("function");
    expect(typeof getBlock).toBe("function");
    expect(typeof createPosition).toBe("function");
    expect(typeof createSpan).toBe("function");
    expect(typeof mergeAdjacentTextItems).toBe("function");
    expect(typeof attrsEqual).toBe("function");
    expect(typeof createTestAllocator).toBe("function");
  });

  it("surfaces Layer 2 pure utilities", () => {
    expect(typeof nextBlockInDocOrder).toBe("function");
    expect(typeof compareBlocksInDocOrder).toBe("function");
    expect(typeof iterateSpan).toBe("function");
    expect(typeof extractText).toBe("function");
  });

  it("surfaces Layer 3 ops", () => {
    expect(typeof insertText).toBe("function");
    expect(typeof deleteRange).toBe("function");
    expect(typeof splitBlockAtPosition).toBe("function");
    expect(typeof setBlockType).toBe("function");
    expect(typeof reparentChildren).toBe("function");
    expect(typeof applySectionBreak).toBe("function");
  });

  it("surfaces History", () => {
    expect(typeof createHistory).toBe("function");
    expect(typeof History).toBe("function");
  });

  it("surfaces the boot helper", () => {
    expect(typeof createEmptyDocument).toBe("function");
  });

  it("end-to-end: the barrel's symbols compose into a usable pipeline", () => {
    // Build an empty doc, insert text, read it back — all through the barrel.
    const allocator = createTestAllocator();
    const state = createEmptyDocument({ allocator });
    const root = getBlock(state, state.rootId);
    expect(root).not.toBeNull();
    const paragraphId = root?.firstChildId;
    expect(paragraphId).toBeTruthy();
    if (!paragraphId) throw new Error("seeded paragraph missing");

    const { state: next } = insertText(
      state,
      createPosition(paragraphId, 0),
      "hi",
      {},
    );
    const paragraph = getBlock(next, paragraphId);
    expect(paragraph?.inlineContent?.items[0]).toMatchObject({
      kind: "text",
      text: "hi",
    });
  });
});

describe("state/index barrel — encapsulation", () => {
  it("does NOT re-export STATE_INTERNAL (Yjs encapsulation stays closed)", () => {
    // No export NAMED "STATE_INTERNAL"...
    expect("STATE_INTERNAL" in barrel).toBe(false);
    // ...and the symbol VALUE is absent from the barrel's export set under ANY
    // name (catches a hypothetical `export { STATE_INTERNAL as x }` leak that a
    // string-key check alone would miss). The symbol is a unique symbol, so
    // value-identity is the authoritative test.
    expect(Object.getOwnPropertySymbols(barrel)).not.toContain(STATE_INTERNAL);
    expect(Object.values(barrel)).not.toContain(STATE_INTERNAL);
  });

  it("does NOT re-export Y.Doc construction / read-write infra", () => {
    // A sampling of infra symbols that must remain state-module-private.
    for (const infra of [
      "createYDoc",
      "getBlocksMap",
      "getEmbedContentsMap",
      "runTransaction",
      "getMetaMap",
      "getMetaRootId",
      "buildYBlock",
      "buildBlockSnapshot",
      "isDevMode",
      "buildStateFromBlocks",
      "getEmbedContentRootIds",
      "getTemplateContentRootIds",
      "BLOCK_FIELDS",
    ]) {
      expect(infra in barrel).toBe(false);
    }
  });

  it("does NOT re-export the internal write-list / clone machinery or the blockKindOf wrapper", () => {
    // SR2 #350/#351: the reparent write-list machinery and the paste-clone
    // helper are state-module-internal (their only intra-core callers import
    // them directly from their source files); `blockKindOf` was removed in
    // favour of calling `resolver.getBlockKind(type)` directly. None of these
    // belong on the barrel's public op surface.
    for (const internal of [
      "clonePastedSubtree",
      "computeReparentWrites",
      "planReparentChildren",
      "reparentChildrenInTx",
      "blockKindOf",
    ]) {
      expect(internal in barrel).toBe(false);
    }
  });
});

/**
 * Perf test for `findOwningBlockId`.
 *
 * Looking up the owning BlockId of a deeply nested Y.Text must be O(1) in the
 * document's block count — the function runs once per changed nested Y type per
 * keystroke, and pagination/virtualization demand O(visible-blocks) per keystroke.
 *
 * The previous implementation walked up to the block-level Y.Map and then
 * linear-scanned the entire outer map (O(N) per call). The current implementation
 * reads `_item.parentSub` for an O(1) lookup.
 *
 * The assertion is RELATIVE, not an absolute wall-clock budget: we measure the
 * per-call cost at a small N and a large N and assert the large-N cost does not
 * blow up proportionally to N. An O(1) lookup keeps the ratio near 1 regardless of
 * machine load; the old O(N) scan would make the 10K-block run ~100× the
 * 100-block run. A relative ratio is immune to CPU contention (both measurements
 * inflate together under load), so the full suite never flakes here — while still
 * catching an O(1)→O(N) regression by a wide margin.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import {
  createYDoc,
  findOwningBlockIdForTest,
  getBlocksMap,
  getEmbedContentsMap,
  getTemplateContentsMap,
  runTransaction,
} from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";

/** Build an N-paragraph doc, each paragraph holding one text run (a nested Y.Text). */
function buildDoc(n: number): Y.Doc {
  const doc = createYDoc({ rootId: "root" as BlockId });
  runTransaction(doc, () => {
    const yBlocks = getBlocksMap(doc);
    yBlocks.set(
      "root",
      buildYBlock({
        type: "document",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: "p-0" as BlockId,
        lastChildId: `p-${n - 1}` as BlockId,
        inlineContent: null,
      }),
    );
    for (let i = 0; i < n; i++) {
      yBlocks.set(
        `p-${i}` as BlockId,
        buildYBlock({
          type: "paragraph",
          attrs: {},
          parentId: "root" as BlockId,
          prevSiblingId: i > 0 ? (`p-${i - 1}` as BlockId) : null,
          nextSiblingId: i < n - 1 ? (`p-${i + 1}` as BlockId) : null,
          firstChildId: null,
          lastChildId: null,
          // One text run per block: a Y.Text inside Y.Array inside Y.Map.
          inlineContent: { items: [{ kind: "text", text: `block ${i}`, attrs: {} }] },
        }),
      );
    }
  });
  return doc;
}

/** Mean per-call time (µs) of looking up the owning block of a mid-tree Y.Text. */
function perCallUs(doc: Y.Doc, targetBlockId: BlockId): number {
  const yBlocks = getBlocksMap(doc);
  const yBlock = yBlocks.get(targetBlockId);
  if (yBlock === undefined) throw new Error("test setup failed");
  const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const yText = yInline.get(0).get("text") as Y.Text;

  type TreeMapsArg = Parameters<typeof findOwningBlockIdForTest>[0];
  type TypeArg = Parameters<typeof findOwningBlockIdForTest>[1];
  const treeMaps = [
    yBlocks,
    getEmbedContentsMap(doc),
    getTemplateContentsMap(doc),
  ] as unknown as TreeMapsArg;
  const yTextArg = yText as unknown as TypeArg;

  // Correctness check (defensive — guards against a refactor breaking the lookup).
  expect(findOwningBlockIdForTest(treeMaps, yTextArg)).toBe(targetBlockId);

  // Warm up (JIT + caches), then time a batch.
  for (let i = 0; i < 200; i++) findOwningBlockIdForTest(treeMaps, yTextArg);
  const iterations = 2000;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) findOwningBlockIdForTest(treeMaps, yTextArg);
  return ((performance.now() - t0) / iterations) * 1000;
}

describe("findOwningBlockId perf", () => {
  it("does not scale with block count — O(1), not O(N) (relative, contention-proof)", () => {
    const SMALL = 100;
    const LARGE = 10000;

    // Build BOTH docs before timing EITHER, so GC from constructing the 10K-block
    // doc settles before the timing loops run (otherwise a GC pause triggered by
    // LARGE's construction could fire inside LARGE's timing window and inflate it
    // without inflating SMALL — a reverse-flake the up-front build avoids).
    const smallDoc = buildDoc(SMALL);
    const largeDoc = buildDoc(LARGE);
    const small = perCallUs(smallDoc, `p-${Math.floor(SMALL * 0.75)}` as BlockId);
    const large = perCallUs(largeDoc, `p-${Math.floor(LARGE * 0.75)}` as BlockId);

    // O(1): ratio ≈ 1 regardless of machine load. The old O(N) scan would make the
    // 100×-larger doc ~100× slower per call; a cap of 12× catches that regression
    // decisively while absorbing measurement noise + CPU contention (which inflates
    // both measurements together, leaving the ratio ~unchanged). Guard the
    // denominator against a near-zero baseline so a fast machine can't make the
    // ratio explode on noise alone.
    const ratio = large / Math.max(small, 0.05);
    expect(ratio).toBeLessThan(12);
  });
});

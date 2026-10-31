/**
 * Perf smoke tests for the state layer's per-keystroke hot paths.
 *
 * The setBlockAttrs assertion is an AVERAGED per-op latency bound, not a
 * single-shot wall-clock budget. A prior `< 50ms` single-call assertion flaked
 * under full-suite CPU contention (one setBlockAttrs call timed at 367ms behind
 * the BidiTest conformance run, vs ~0.4ms typical). Averaging over thousands of
 * calls is the contention defence: a 367ms spike spread across 2000 ops adds
 * <0.2ms to the mean, so the bound holds even under heavy load while still
 * catching a real keystroke-latency regression. The bound is generous (~25× the
 * observed per-op cost) and machine-independent enough for CI.
 *
 * This smoke guards keystroke LATENCY ("a keystroke is fast"), not the
 * document-size scaling CURVE: setBlockAttrs carries a mild sub-linear doc-size
 * cost (≈7× across a 50× block-count growth) whose noisy single-run measurement
 * is unsuitable for a flake-free unit gate — that curve belongs in a profiling
 * bench, not here (cf. `perf-find-owning-block.test.ts`, whose O(1) lookup IS
 * clean enough to gate on a ratio).
 */
import { describe, it, expect } from "vitest";
import { getBlock } from "./document";
import type { Document } from "./document";
import { setBlockAttrs } from "./ops/set-block-attrs";
import type { BlockId } from "./block-id";
import { buildBlock, buildDocument, inlineContent } from "../test-utils/document-builders";

/** A flat N-paragraph document: root + empty paragraphs p-0 … p-(n-1). */
function buildFlatDoc(n: number): Document {
  const ids = Array.from({ length: n }, (_, i) => `p-${i}`);
  return buildDocument({
    rootId: "root",
    blocks: [
      buildBlock({ id: "root", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[n - 1] ?? null }),
      ...ids.map((id, i) =>
        buildBlock({
          id,
          type: "paragraph",
          parentId: "root",
          prevSiblingId: ids[i - 1] ?? null,
          nextSiblingId: ids[i + 1] ?? null,
          inlineContent: inlineContent([]),
        }),
      ),
    ],
  });
}

describe("perf benchmark (smoke)", () => {
  it("setBlockAttrs stays fast per keystroke on a large document (averaged, contention-proof)", () => {
    const LARGE = 10000;
    const document = buildFlatDoc(LARGE);
    const blockId = `p-${Math.floor(LARGE * 0.75)}` as BlockId;

    // Correctness (defensive — a setBlockAttrs that stopped dirtying its own block
    // would make the perf claim meaningless).
    expect(setBlockAttrs(document, blockId, { order: -1 }).dirtyIds.has(blockId)).toBe(true);

    // Warm up (JIT + snapshot-cache base materialization), then AVERAGE over many
    // calls — averaging is the contention defence (see file header). Each call sets a
    // DISTINCT value so the no-op short-circuit never fires (it would otherwise
    // measure the cheap identity path, not the real write); calls share the same base
    // `document`, so each is an independent op.
    for (let i = 0; i < 200; i++) setBlockAttrs(document, blockId, { order: i });
    const iterations = 2000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) setBlockAttrs(document, blockId, { order: i });
    const perOpMs = (performance.now() - t0) / iterations;

    // Generous bound (~25× the observed ~0.4ms/op): a per-keystroke attr write
    // averaging >10ms on a 10k-block doc is a real regression worth catching.
    expect(perOpMs).toBeLessThan(10);
  });

  it("getBlock on cached snapshot is sub-millisecond", () => {
    const document = buildFlatDoc(1);
    // Prime the cache.
    getBlock(document, "root" as BlockId);
    // Time 10k cache-hits (averaged → robust to a single contention spike).
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      getBlock(document, "root" as BlockId);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed / 10000).toBeLessThan(0.01); // <10us per cache hit.
  });
});

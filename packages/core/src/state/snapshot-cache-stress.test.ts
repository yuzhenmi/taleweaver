import { describe, it, expect } from "vitest";
import { getBlock, type Document } from "./document";
import type { BlockId } from "./block-id";
import { setBlockAttrs } from "./ops/set-block-attrs";
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

describe("snapshot cache (stress)", () => {
  it("reuses cached snapshots for unchanged blocks after a single-block mutation", () => {
    const document = buildFlatDoc(100);

    // Materialize all 100 snapshots into the cache.
    const before: Array<ReturnType<typeof getBlock>> = [];
    for (let i = 0; i < 100; i++) {
      before.push(getBlock(document, `p-${i}` as BlockId));
    }

    // Mutate just one block.
    const result = setBlockAttrs(document, "p-42" as BlockId, { bold: true });

    // For the new state, "p-42" should be a fresh snapshot.
    expect(getBlock(result.document, "p-42" as BlockId)?.attrs.bold).toBe(true);

    // For unchanged blocks, the carry-forward cache in applyOperation guarantees
    // identity reuse — the new state returns the same snapshot object as the old.
    for (let i = 0; i < 100; i++) {
      if (i === 42) continue;
      const a = before[i];
      const b = getBlock(result.document, `p-${i}` as BlockId);
      expect(b).toBe(a);
    }
  });
});

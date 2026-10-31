import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyOperation } from "./document";
import { writeBlockType } from "./flow-ops";
import { buildDocument, buildBlock } from "../test-utils/document-builders";
import type { BlockId } from "./index";

function singleBlockDocument() {
  return buildDocument({
    rootId: "root",
    blocks: [
      buildBlock({
        id: "root",
        type: "doc",
        firstChildId: "p1",
        lastChildId: "p1",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "root",
        inlineContent: { items: [] },
      }),
    ],
  });
}

describe("applyOperation extra-dirty return channel", () => {
  it("unions ids returned by fn into dirtyIds even when the txn touched no blocks", () => {
    const document = singleBlockDocument();
    const extra = new Set<BlockId>(["p1" as BlockId]);
    const result = applyOperation(document, (doc) => {
      // Mutate a NON-block-tree map (mirrors a listDefs-only write).
      doc.getMap("listDefs").set("L1", new Y.Map());
      return extra;
    });
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
    expect(result.document).not.toBe(document); // did NOT short-circuit
  });

  it("still short-circuits when fn returns no extra ids and touches nothing", () => {
    const document = singleBlockDocument();
    const result = applyOperation(document, () => {
      /* no-op */
    });
    expect(result.dirtyIds.size).toBe(0);
    expect(result.document).toBe(document);
  });

  it("unions extra ids with block-tree-captured ids", () => {
    const document = singleBlockDocument();
    const result = applyOperation(document, (doc) => {
      writeBlockType(doc, "p1", "heading"); // captured as dirty p1 by the txn
      return new Set<BlockId>(["root" as BlockId]); // extra
    });
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("root" as BlockId)).toBe(true);
  });
});

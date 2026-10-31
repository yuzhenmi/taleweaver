import { TEST_RESOLVER } from "../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createEmptyDocument } from "./create-empty-document";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { createDocument, getBlock } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";

describe("yjs-encoding", () => {
  it("round-trips a single-paragraph document via update bytes", () => {
    const original = createEmptyDocument({ resolver: TEST_RESOLVER });
    const update = Y.encodeStateAsUpdate(original[DOCUMENT_INTERNAL].doc);

    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, update);
    const restored = createDocument({ resolver: TEST_RESOLVER, rootId: original.rootId, doc: restoredDoc });

    const a = getBlock(original, original.rootId);
    const b = getBlock(restored, original.rootId);
    expect(b?.type).toBe(a?.type);
    expect(b?.firstChildId).toBe(a?.firstChildId);
  });

  it("round-trips a mutated document", () => {
    let document = createEmptyDocument({ resolver: TEST_RESOLVER });
    const child = getBlock(document, getBlock(document, document.rootId)!.firstChildId!)!;
    document = setBlockAttrs(document, child.id, { bold: true }).document;

    const update = Y.encodeStateAsUpdate(document[DOCUMENT_INTERNAL].doc);
    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, update);
    const restored = createDocument({ resolver: TEST_RESOLVER, rootId: document.rootId, doc: restoredDoc });

    expect(getBlock(restored, child.id)?.attrs.bold).toBe(true);
  });
});

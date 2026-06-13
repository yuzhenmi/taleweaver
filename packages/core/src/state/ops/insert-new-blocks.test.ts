/**
 * PF-0 (paste-as-suggestion): `insertNewBlocksInTx` materializes a run of NEW
 * leaf blocks whose parent/sibling pointers are already fully resolved as DATA,
 * into each block's OWN tree (`kind`). Unlike `insertBlocksAfterInTx` (main-tree
 * only, computes prev/next from an `afterBlockId` anchor), this primitive does
 * NOT rewire any existing block — the caller's plan owns the boundary writes.
 * It is the bulk-insert foundation the fragment plan builds on.
 */
import { describe, it, expect } from "vitest";
import { insertNewBlocksInTx, type NewBlockSpec } from "./insert-new-blocks";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { applyOperation, resolveBlock } from "../state";
import { asBlockId } from "../block-id";
import { getYBlock } from "../yjs-doc";

describe("insertNewBlocksInTx — materialize pre-linked new blocks (PF-0)", () => {
  it("writes a run of new MAIN-tree blocks with verbatim pre-linked pointers", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("x")]) }),
      ],
    });
    const specs: NewBlockSpec[] = [
      { id: asBlockId("n1"), kind: "block", type: "paragraph", attrs: {}, items: [text("a")],
        parentId: asBlockId("doc"), prevSiblingId: asBlockId("p"), nextSiblingId: asBlockId("n2") },
      { id: asBlockId("n2"), kind: "block", type: "paragraph", attrs: {}, items: [text("b")],
        parentId: asBlockId("doc"), prevSiblingId: asBlockId("n1"), nextSiblingId: null },
    ];
    // The primitive does NOT rewire neighbors — that's the caller's job. Mirror it
    // so the resulting chain is consistent (else the assertChainIntegrity dev
    // invariant rejects the op). p was doc's last child, so doc.lastChildId → n2.
    const next = applyOperation(state, (doc) => {
      insertNewBlocksInTx(doc, specs);
      getYBlock(doc, asBlockId("p"), "test", "block").set("nextSiblingId", asBlockId("n1"));
      getYBlock(doc, asBlockId("doc"), "test", "block").set("lastChildId", asBlockId("n2"));
    }).state;
    const n1 = resolveBlock(next, asBlockId("n1"))?.block;
    const n2 = resolveBlock(next, asBlockId("n2"))?.block;
    expect(n1?.parentId).toBe("doc");
    expect(n1?.prevSiblingId).toBe("p");
    expect(n1?.nextSiblingId).toBe("n2");
    expect((n1?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("a");
    expect(n2?.prevSiblingId).toBe("n1");
    expect(n2?.nextSiblingId).toBeNull();
  });

  it("routes writes into the EMBED tree when kind = embedContent", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
               buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("m")]) })],
      embedContents: [
        buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const specs: NewBlockSpec[] = [
      { id: asBlockId("e1"), kind: "embedContent", type: "paragraph", attrs: {}, items: [text("z")],
        parentId: asBlockId("fn"), prevSiblingId: asBlockId("fnp"), nextSiblingId: null },
    ];
    const next = applyOperation(state, (doc) => {
      insertNewBlocksInTx(doc, specs);
      getYBlock(doc, asBlockId("fnp"), "test", "embedContent").set("nextSiblingId", asBlockId("e1"));
      getYBlock(doc, asBlockId("fn"), "test", "embedContent").set("lastChildId", asBlockId("e1"));
    }).state;
    const e1 = resolveBlock(next, asBlockId("e1"));
    expect(e1?.kind).toBe("embedContent"); // resolved from the embed tree, not main
    expect(e1?.block.parentId).toBe("fn");
  });

  it("throws on an id collision with an existing block (dev defense)", () => {
    const state = buildState({ rootId: "doc", blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("x")]) }) ] });
    const specs: NewBlockSpec[] = [{ id: asBlockId("p"), kind: "block", type: "paragraph", attrs: {}, items: [],
      parentId: asBlockId("doc"), prevSiblingId: asBlockId("doc"), nextSiblingId: null }];
    expect(() => applyOperation(state, (doc) => { insertNewBlocksInTx(doc, specs); })).toThrow();
  });
});

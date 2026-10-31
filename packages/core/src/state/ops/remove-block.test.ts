import { describe, it, expect } from "vitest";
import { removeBlock } from "./remove-block";
import { getBlock, getEmbedContent } from "../document";
import { TEST_RESOLVER, testContainer, buildBlock, buildDocument, buildFlowDoc, finalSectionOf, embed, inlineContent, text } from "../../test-utils/document-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import type { BlockId } from "../block-id";

// Host container types the default registry lacks (file-local registry instance).
TEST_RESOLVER.register(testContainer("blockquote"));

describe("removeBlock — middle child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p3] (p2 removed)
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("removes the block from state.blocks", () => {
    const document = fixture();
    const result = removeBlock(document, "p2" as BlockId);
    expect(getBlock(result.document, "p2" as BlockId)).toBeNull();
  });

  it("relinks adjacent siblings (p1.nextSiblingId, p3.prevSiblingId)", () => {
    const document = fixture();
    const result = removeBlock(document, "p2" as BlockId);
    expect(getBlock(result.document, "p1" as BlockId)?.nextSiblingId).toBe("p3");
    expect(getBlock(result.document, "p3" as BlockId)?.prevSiblingId).toBe("p1");
  });

  it("does not change parent's firstChildId / lastChildId for a middle removal", () => {
    const document = fixture();
    const result = removeBlock(document, "p2" as BlockId);
    const F = finalSectionOf(result.document);
    expect(getBlock(result.document, F)?.firstChildId).toBe("p1");
    expect(getBlock(result.document, F)?.lastChildId).toBe("p3");
  });

  it("returns dirtyIds for the removed block + adjacent siblings", () => {
    const document = fixture();
    const result = removeBlock(document, "p2" as BlockId);
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["p2", "p1", "p3"]));
  });
});

describe("removeBlock — container block with children (subtree cascade)", () => {
  // doc > [section > [p1, p2], p3]
  // Removing `section` must also delete p1 and p2, otherwise they'd
  // be orphaned (their parentId points to a removed block) — violates
  // the spec's "no orphaned blocks" invariant.
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "p3" }),
        // A generic container (a SECTION would own p3 too: root content after a
        // section mark belongs to that section).
        buildBlock({ id: "section", type: "blockquote", parentId: "doc", nextSiblingId: "p3", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "section", inlineContent: inlineContent([]) }),
      ],
    });

  it("deletes the named block AND its entire subtree from state.blocks", () => {
    const document = fixture();
    const result = removeBlock(document, "section" as BlockId);
    expect(getBlock(result.document, "section" as BlockId)).toBeNull();
    expect(getBlock(result.document, "p1" as BlockId)).toBeNull();
    expect(getBlock(result.document, "p2" as BlockId)).toBeNull();
    // Sibling p3 is unaffected:
    expect(getBlock(result.document, "p3" as BlockId)).not.toBeNull();
    // Root unaffected:
    expect(getBlock(result.document, "doc" as BlockId)).not.toBeNull();
  });

  it("includes every id in the deleted subtree in dirtyIds, plus parent + sibling rewires", () => {
    const document = fixture();
    const result = removeBlock(document, "section" as BlockId);
    // dirty: the container + its subtree, the parent section (first child rewired), p3 (prev link).
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["section", "p1", "p2", finalSectionOf(result.document), "p3"]));
  });

  it("preserves the no-orphans invariant after a container removal", () => {
    const document = fixture();
    const result = removeBlock(document, "section" as BlockId);
    // Every remaining block must be reachable from rootId via parent/child links.
    // A simple check: every remaining block's parentId is either null (root) or
    // present in the result map.
    for (const id of ["doc", "p3"] as const) {
      const b = getBlock(result.document, id as BlockId);
      expect(b).not.toBeNull();
      if (b === null) continue;
      if (id === result.document.rootId) continue;
      expect(b.parentId).not.toBeNull();
      if (b.parentId !== null) {
        expect(getBlock(result.document, b.parentId)).not.toBeNull();
      }
    }
  });
});

describe("removeBlock — first child", () => {
  // doc > [p1, p2, p3]  →  doc > [p2, p3] (p1 removed)
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates parent.firstChildId when removing the first child", () => {
    const document = fixture();
    const result = removeBlock(document, "p1" as BlockId);
    const F = finalSectionOf(result.document);
    expect(getBlock(result.document, F)?.firstChildId).toBe("p2");
    expect(getBlock(result.document, F)?.lastChildId).toBe("p3");
    expect(getBlock(result.document, "p2" as BlockId)?.prevSiblingId).toBeNull();
  });

  it("includes the parent in dirtyIds (firstChildId changed) — boundary removal", () => {
    const document = fixture();
    const result = removeBlock(document, "p1" as BlockId);
    // p1 (deleted), p2 (prev link rewired), the parent section (first child changed).
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["p1", "p2", finalSectionOf(result.document)]));
  });
});

describe("removeBlock — the flow's last paragraph (Word: the final ¶ is never deleted — I2)", () => {
  it("removing the last child deletes its content and keeps its ¶: nothing merges", () => {
    const document = buildFlowDoc([{ p: "p1", t: "a" }, { p: "p2", t: "b" }, { p: "p3", t: "end" }]);
    const result = removeBlock(document, "p3" as BlockId);
    expect(flowShape(result.document, "doc")).toBe('p1:"a" p2:"b" p3:""');
    assertInvariantI(result.document, "storage");
  });

  it("removing an already-empty last child changes nothing", () => {
    const document = buildFlowDoc([{ p: "p1", t: "a" }, { p: "p3", t: "" }]);
    const result = removeBlock(document, "p3" as BlockId);
    expect(flowShape(result.document, "doc")).toBe('p1:"a" p3:""');
    expect(result.dirtyIds.size).toBe(0);
  });

  it("removing the only child leaves it as the document's one empty paragraph", () => {
    const document = buildFlowDoc([{ p: "p1", t: "only" }]);
    const result = removeBlock(document, "p1" as BlockId);
    expect(flowShape(result.document, "doc")).toBe('p1:""');
    expect(getBlock(result.document, finalSectionOf(result.document))?.firstChildId).toBe("p1");
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
  });
});


describe("removeBlock — error cases", () => {
  it("throws when the block does not exist", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(document, "missing" as BlockId)).toThrow(/not found/);
  });

  it("throws when attempting to remove the document root", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(document, "doc" as BlockId)).toThrow(/cannot remove the document root/);
  });

  it("a parentless non-root block is not in the read model (only flow-resident blocks exist)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document" }),
        buildBlock({ id: "orphan", type: "paragraph", inlineContent: inlineContent([]) }), // no parentId
      ],
    });
    expect(() => removeBlock(document, "orphan" as BlockId)).toThrow(/not found/);
  });
});

describe("removeBlock — cascade-delete embed-content references", () => {
  it("removes a referenced fn-body when its anchor block is removed", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
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
    expect(getEmbedContent(document, "fn-body-1" as BlockId)).not.toBeNull();

    const result = removeBlock(document, "p1" as BlockId);
    expect(getEmbedContent(result.document, "fn-body-1" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-body-1" as BlockId)).toBe(true);
  });

  it("recursively removes nested embed-content references (footnote in footnote)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "outer" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "outer",
          type: "fn-body",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "inner" })]),
        }),
        buildBlock({
          id: "inner",
          type: "fn-body",
          inlineContent: inlineContent([text("deep")]),
        }),
      ],
    });

    const result = removeBlock(document, "p1" as BlockId);
    expect(getEmbedContent(result.document, "outer" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "inner" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("outer" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("inner" as BlockId)).toBe(true);
  });

  // Sharing of an embedContent body across two anchors is unsupported by design
  // (see docs/superpowers/specs/2026-05-30-367-shared-embedcontent-decision.md).
  // The dev invariant that catches it — `assertNoSharedEmbedContent` — is tested
  // in embed-content-cascade.test.ts. Under the no-sharing model the
  // unconditional cascade-delete in removeBlock is correct, so removeBlock has
  // no special-case behaviour to pin here.
});

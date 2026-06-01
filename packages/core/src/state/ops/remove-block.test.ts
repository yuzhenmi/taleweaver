import { describe, it, expect } from "vitest";
import { removeBlock } from "./remove-block";
import { getBlock, getEmbedContent } from "../state";
import { buildBlock, buildState, embed, inlineContent, text } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

describe("removeBlock — middle child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p3] (p2 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("removes the block from state.blocks", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
  });

  it("relinks adjacent siblings (p1.nextSiblingId, p3.prevSiblingId)", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p3");
    expect(getBlock(result.state, "p3" as BlockId)?.prevSiblingId).toBe("p1");
  });

  it("does not change parent's firstChildId / lastChildId for a middle removal", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p3");
  });

  it("returns dirtyIds for removed block + adjacent siblings, NOT the parent (middle removal leaves the parent's boundaries unchanged)", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    // New contract (mirrors insertBlock): a block is in dirtyIds iff its OWN
    // fields changed. A middle removal rewires only the two adjacent siblings;
    // the parent's firstChildId/lastChildId are untouched, so the parent is
    // NOT dirtied here. The parent still re-renders via render's
    // computeInvalidatedBlocks ancestor-walk (the deleted child ∈ dirtyIds
    // resolves through prevState → its parent is invalidated).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p1", "p3"]));
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(false);
  });
});

describe("removeBlock — container block with children (subtree cascade)", () => {
  // doc > [section > [p1, p2], p3]
  // Removing `section` must also delete p1 and p2, otherwise they'd
  // be orphaned (their parentId points to a removed block) — violates
  // the spec's "no orphaned blocks" invariant.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "p3" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", nextSiblingId: "p3", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "section", inlineContent: inlineContent([]) }),
      ],
    });

  it("deletes the named block AND its entire subtree from state.blocks", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    expect(getBlock(result.state, "section" as BlockId)).toBeNull();
    expect(getBlock(result.state, "p1" as BlockId)).toBeNull();
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
    // Sibling p3 is unaffected:
    expect(getBlock(result.state, "p3" as BlockId)).not.toBeNull();
    // Root unaffected:
    expect(getBlock(result.state, "doc" as BlockId)).not.toBeNull();
  });

  it("includes every id in the deleted subtree in dirtyIds, plus parent + sibling rewires", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    // dirty: section (deleted), p1 (deleted descendant), p2 (deleted descendant),
    //        doc (parent — firstChildId rewired), p3 (next sibling — prevSiblingId rewired).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["section", "p1", "p2", "doc", "p3"]));
  });

  it("preserves the no-orphans invariant after a container removal", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    // Every remaining block must be reachable from rootId via parent/child links.
    // A simple check: every remaining block's parentId is either null (root) or
    // present in the result map.
    for (const id of ["doc", "p3"] as const) {
      const b = getBlock(result.state, id as BlockId);
      expect(b).not.toBeNull();
      if (b === null) continue;
      if (id === result.state.rootId) continue;
      expect(b.parentId).not.toBeNull();
      if (b.parentId !== null) {
        expect(getBlock(result.state, b.parentId)).not.toBeNull();
      }
    }
  });
});

describe("removeBlock — first child", () => {
  // doc > [p1, p2, p3]  →  doc > [p2, p3] (p1 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates parent.firstChildId when removing the first child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p2");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p3");
    expect(getBlock(result.state, "p2" as BlockId)?.prevSiblingId).toBeNull();
  });

  it("includes the parent in dirtyIds (firstChildId changed) — boundary removal", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    // p1 (deleted), p2 (next sibling — prevSiblingId rewired), doc (parent —
    // firstChildId changed). No prev sibling.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);
  });
});

describe("removeBlock — last child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p2] (p3 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates parent.lastChildId when removing the last child", () => {
    const state = fixture();
    const result = removeBlock(state, "p3" as BlockId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2");
    expect(getBlock(result.state, "p2" as BlockId)?.nextSiblingId).toBeNull();
  });

  it("includes the parent in dirtyIds (lastChildId changed) — boundary removal", () => {
    const state = fixture();
    const result = removeBlock(state, "p3" as BlockId);
    // p3 (deleted), p2 (prev sibling — nextSiblingId rewired), doc (parent —
    // lastChildId changed). No next sibling.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p3", "p2", "doc"]));
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);
  });
});

describe("removeBlock — only child", () => {
  // doc > [p1]  →  doc > [] (p1 removed; doc becomes empty)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });

  it("clears both firstChildId and lastChildId when removing the only child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBeNull();
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBeNull();
    // Both firstChildId and lastChildId change → parent is dirtied. No siblings.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "doc"]));
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);
  });
});

describe("removeBlock — error cases", () => {
  it("throws when the block does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(state, "missing" as BlockId)).toThrow(/not found/);
  });

  it("throws when attempting to remove the document root", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => removeBlock(state, "doc" as BlockId)).toThrow(/cannot remove the document root/);
  });

  it("throws when removing a non-root block with no parent (malformed state)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document" }),
        buildBlock({ id: "orphan", type: "paragraph", inlineContent: inlineContent([]) }), // no parentId
      ],
    });
    expect(() => removeBlock(state, "orphan" as BlockId)).toThrow(/no parentId/);
  });
});

describe("removeBlock — cascade-delete embed-content references", () => {
  it("removes a referenced fn-body when its anchor block is removed", () => {
    const state = buildState({
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
    expect(getEmbedContent(state, "fn-body-1" as BlockId)).not.toBeNull();

    const result = removeBlock(state, "p1" as BlockId);
    expect(getEmbedContent(result.state, "fn-body-1" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-body-1" as BlockId)).toBe(true);
  });

  it("recursively removes nested embed-content references (footnote in footnote)", () => {
    const state = buildState({
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

    const result = removeBlock(state, "p1" as BlockId);
    expect(getEmbedContent(result.state, "outer" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "inner" as BlockId)).toBeNull();
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

import { describe, it, expect } from "vitest";
import { mergeSectionWithPrevious } from "./merge-section";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

/**
 * Read every structural pointer of a block as a plain object so assertions
 * can compare the whole 5-pointer shape at once.
 */
function pointers(state: ReturnType<typeof buildState>, id: string) {
  const b = getBlock(state, id as BlockId);
  if (b === null) throw new Error(`block ${id} not found`);
  return {
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId: b.lastChildId,
  };
}

/** Walk a container's child chain via firstChildId/nextSiblingId. */
function childIds(state: ReturnType<typeof buildState>, parentId: string): string[] {
  const parent = getBlock(state, parentId as BlockId);
  if (parent === null) throw new Error(`block ${parentId} not found`);
  const out: string[] = [];
  let cur = parent.firstChildId;
  let guard = 0;
  while (cur !== null) {
    if (++guard > 10000) throw new Error("childIds: runaway chain");
    out.push(cur);
    const b = getBlock(state, cur);
    if (b === null) throw new Error(`block ${cur} not found mid-chain`);
    cur = b.nextSiblingId;
  }
  return out;
}

const bid = (s: string) => s as BlockId;

describe("mergeSectionWithPrevious — two sections [P{a,b}, X{c,d}] → merge X", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "X" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "X", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "X", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "c", lastChildId: "d" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "X", nextSiblingId: "d", inlineContent: inlineContent([]) }),
        buildBlock({ id: "d", type: "paragraph", parentId: "X", prevSiblingId: "c", inlineContent: inlineContent([]) }),
      ],
    });

  it("reparents X's children onto the end of P, deletes X, relinks the doc root", () => {
    const state = fixture();
    const result = mergeSectionWithPrevious(state, bid("X"));

    // Root now has exactly one child: P.
    expect(childIds(result.state, "doc")).toEqual(["P"]);
    expect(pointers(result.state, "doc")).toMatchObject({
      firstChildId: "P",
      lastChildId: "P",
    });

    // X is gone.
    expect(getBlock(result.state, bid("X"))).toBeNull();

    // P now holds a→b→c→d in order.
    expect(childIds(result.state, "P")).toEqual(["a", "b", "c", "d"]);

    // P's section pointers.
    expect(pointers(result.state, "P")).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: "a",
      lastChildId: "d",
    });

    // Seam: b ↔ c stitched; tail d terminated.
    expect(getBlock(result.state, bid("c"))?.parentId).toBe("P");
    expect(getBlock(result.state, bid("c"))?.prevSiblingId).toBe("b");
    expect(getBlock(result.state, bid("b"))?.nextSiblingId).toBe("c");
    expect(getBlock(result.state, bid("d"))?.parentId).toBe("P");
    expect(getBlock(result.state, bid("d"))?.nextSiblingId).toBeNull();
    expect(getBlock(result.state, bid("a"))?.prevSiblingId).toBeNull();
  });

  it("dirtyIds contains the moved children + P + X (+ root)", () => {
    const state = fixture();
    const result = mergeSectionWithPrevious(state, bid("X"));
    const dirty = new Set(result.dirtyIds);
    // Moved children + previous section + removed section.
    for (const id of ["c", "d", "P", "X"]) {
      expect(dirty.has(id as BlockId)).toBe(true);
    }
    // X was the doc-root tail; removing it updates the root's lastChildId.
    expect(dirty.has(bid("doc"))).toBe(true);
    // `b` is the append ANCHOR (P's prior last child): its nextSiblingId is
    // rewired to `c`, so it IS dirty. But `a` (P's non-adjacent first child) is
    // never rewritten ⇒ NOT dirty — proving the merge touches only the seam.
    expect(dirty.has(bid("b"))).toBe(true);
    expect(dirty.has(bid("a"))).toBe(false);
  });
});

describe("mergeSectionWithPrevious — three sections [P{a}, X{b}, Y{c}] → merge X", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Y" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "X", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "X", type: "section", parentId: "doc", prevSiblingId: "P", nextSiblingId: "Y", firstChildId: "b", lastChildId: "b" }),
        buildBlock({ id: "Y", type: "section", parentId: "doc", prevSiblingId: "X", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "X", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "Y", inlineContent: inlineContent([]) }),
      ],
    });

  it("merges X into P, leaves Y untouched, relinks P ↔ Y", () => {
    const state = fixture();
    const result = mergeSectionWithPrevious(state, bid("X"));

    expect(childIds(result.state, "doc")).toEqual(["P", "Y"]);
    expect(getBlock(result.state, bid("X"))).toBeNull();

    // P now holds [a, b] — assert the append seam explicitly (not just the
    // walked child list): P.lastChild moved to b, and a↔b are linked, b reparented.
    expect(childIds(result.state, "P")).toEqual(["a", "b"]);
    expect(getBlock(result.state, bid("P"))?.lastChildId).toBe("b");
    expect(getBlock(result.state, bid("a"))?.nextSiblingId).toBe("b");
    expect(getBlock(result.state, bid("b"))?.prevSiblingId).toBe("a");
    expect(getBlock(result.state, bid("b"))?.parentId).toBe("P");
    expect(getBlock(result.state, bid("b"))?.nextSiblingId).toBeNull();

    // Doc-root chain re-stitched: P.next === Y, Y.prev === P.
    expect(getBlock(result.state, bid("P"))?.nextSiblingId).toBe("Y");
    expect(getBlock(result.state, bid("Y"))?.prevSiblingId).toBe("P");
    expect(getBlock(result.state, bid("doc"))?.lastChildId).toBe("Y");

    // Y untouched (still holds [c]).
    expect(childIds(result.state, "Y")).toEqual(["c"]);
    expect(pointers(result.state, "Y")).toEqual({
      parentId: "doc",
      prevSiblingId: "P",
      nextSiblingId: null,
      firstChildId: "c",
      lastChildId: "c",
    });
  });
});

describe("mergeSectionWithPrevious — first section (no prev) is a no-op", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "X", lastChildId: "Y" }),
        buildBlock({ id: "X", type: "section", parentId: "doc", nextSiblingId: "Y", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "Y", type: "section", parentId: "doc", prevSiblingId: "X", firstChildId: "b", lastChildId: "b" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "X", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "Y", inlineContent: inlineContent([]) }),
      ],
    });

  it("returns the SAME state reference and empty dirtyIds", () => {
    const state = fixture();
    const result = mergeSectionWithPrevious(state, bid("X"));
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
    // Nothing changed.
    expect(childIds(result.state, "doc")).toEqual(["X", "Y"]);
    expect(childIds(result.state, "X")).toEqual(["a"]);
  });
});

describe("mergeSectionWithPrevious — empty section [P{a}, X{}] → merge X", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "X" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "X", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "X", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: null, lastChildId: null }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", inlineContent: inlineContent([]) }),
      ],
    });

  it("deletes the empty X, leaves P's children intact, chain valid", () => {
    const state = fixture();
    const result = mergeSectionWithPrevious(state, bid("X"));

    expect(childIds(result.state, "doc")).toEqual(["P"]);
    expect(getBlock(result.state, bid("X"))).toBeNull();
    // P's children unchanged.
    expect(childIds(result.state, "P")).toEqual(["a"]);
    expect(pointers(result.state, "P")).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: "a",
      lastChildId: "a",
    });
    expect(getBlock(result.state, bid("doc"))?.lastChildId).toBe("P");
  });
});

describe("mergeSectionWithPrevious — validation", () => {
  it("throws when the section id does not exist", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => mergeSectionWithPrevious(state, bid("nope"))).toThrow(
      /section "nope" not found/,
    );
  });

  it("throws when the id is not a section (a paragraph)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => mergeSectionWithPrevious(state, bid("a"))).toThrow();
  });

  it("throws when the section's parent is not the document root (not a flat doc-root section)", () => {
    // A nested section: wrapper W contains a section X. X.parentId !== rootId.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "W", lastChildId: "W" }),
        buildBlock({ id: "W", type: "section", parentId: "doc", firstChildId: "X", lastChildId: "X" }),
        buildBlock({ id: "X", type: "section", parentId: "W", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "X", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => mergeSectionWithPrevious(state, bid("X"))).toThrow(
      /not a flat doc-root section/,
    );
  });

  it("throws when the previous doc-root sibling is not a section (corrupt state)", () => {
    // A doc-root child that is a paragraph sitting before a section X — violates
    // the flat-section invariant, so merging X must refuse.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "X" }),
        buildBlock({ id: "P", type: "paragraph", parentId: "doc", nextSiblingId: "X", inlineContent: inlineContent([]) }),
        buildBlock({ id: "X", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "X", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => mergeSectionWithPrevious(state, bid("X"))).toThrow();
  });
});

describe("mergeSectionWithPrevious — atomicity (single applyOperation)", () => {
  it("returns one consistent OperationResult: every block reachable + coherent", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "X" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "X", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "X", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "c", lastChildId: "d" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "X", nextSiblingId: "d", inlineContent: inlineContent([]) }),
        buildBlock({ id: "d", type: "paragraph", parentId: "X", prevSiblingId: "c", inlineContent: inlineContent([]) }),
      ],
    });
    const result = mergeSectionWithPrevious(state, bid("X"));

    // All paragraphs reachable from root via child chains; X is not.
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const c of childIds(result.state, id)) visit(c);
    };
    visit("doc");
    for (const id of ["P", "a", "b", "c", "d"]) {
      expect(reachable.has(id)).toBe(true);
    }
    expect(reachable.has("X")).toBe(false);
    // root + one section + four paragraphs.
    expect(reachable.size).toBe(6);
  });
});

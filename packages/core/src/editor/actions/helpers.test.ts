import { describe, it, expect } from "vitest";
import { findFirstContentBlock, findLastContentBlock } from "./helpers";
import { buildState, buildBlock } from "../../test-utils/state-builders";

describe("findFirstContentBlock / findLastContentBlock", () => {
  it("returns the first/last content-bearing LEAF, skipping container blocks", () => {
    // root → [sec (container, child p1), p2]. Content leaves: p1, p2.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "sec", lastChildId: "p2" }),
        buildBlock({ id: "sec", type: "section", parentId: "root", nextSiblingId: "p2", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "sec", inlineContent: { items: [] } }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "root", prevSiblingId: "sec", inlineContent: { items: [] } }),
      ],
    });
    expect(findFirstContentBlock(state)).toBe("p1");
    expect(findLastContentBlock(state)).toBe("p2");
  });

  it("returns null when the document has no content leaf (containers only)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "doc" })],
    });
    expect(findFirstContentBlock(state)).toBeNull();
    expect(findLastContentBlock(state)).toBeNull();
  });

  it("TERMINATES on a malformed two-parents topology with a content-LESS oscillating leaf (#510-class hang regression)", () => {
    // `c` is the firstChildId of BOTH `a` and `b` (its single parentId names only
    // `a`), and `c` is an atomic leaf with NO inline content. Because the search
    // never early-exits at `c` (no content), the OLD `firstLeafBlock` +
    // `while (cursor = nextBlockInDocOrder(...))` / `prevBlockInDocOrder(...)`
    // sweeps oscillate b⇄c forever: nextBlockInDocOrder(c) walks up via
    // c.parentId="a" → a.nextSibling="b", then nextBlockInDocOrder(b) →
    // b.firstChild="c", ad infinitum (a CPU-bound hang that defeats --test-timeout).
    // The cycle-safe leaf walk must TERMINATE — `c` carries no content, so both
    // return null. This assertion would hang forever against the pre-fix code.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "doc", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "section", parentId: "doc", nextSiblingId: "b", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "b", type: "section", parentId: "doc", prevSiblingId: "a", firstChildId: "c", lastChildId: "c" }),
        // atomic leaf: firstChildId null (leaf) AND inlineContent null (no content).
        buildBlock({ id: "c", type: "horizontal-line", parentId: "a" }),
      ],
    });
    expect(findFirstContentBlock(state)).toBeNull();
    expect(findLastContentBlock(state)).toBeNull();
  });
});

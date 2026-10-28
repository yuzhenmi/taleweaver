/**
 * Merge: delete ¶L. The survivor is R (the paragraph whose ¶ ends the
 * joined content). L's type + attrs + ¶ props are written onto R key-wise (Google Docs /
 * Quill: the first paragraph's formatting wins, which also covers an empty R) — unless L
 * is an EMPTY DEFAULT paragraph, which simply goes (Google Docs / Quill). No character moves.
 */
import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import { getBlock, getEmbedContent, type State } from "../state";
import type { Block } from "../block";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import type { BlockId } from "../block-id";

const id = (s: string) => s as BlockId;
function doc(blocks: Block[], embedContents?: Block[]): State {
  const ids = blocks.map((b) => b.id);
  const linked = blocks.map((b, i) => ({ ...b, parentId: id("doc"), prevSiblingId: ids[i - 1] ?? null, nextSiblingId: ids[i + 1] ?? null }));
  return buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }), ...linked], embedContents });
}
const para = (pid: string, items: Parameters<typeof inlineContent>[0], more: Partial<Parameters<typeof buildBlock>[0]> = {}) =>
  buildBlock({ id: pid, type: "paragraph", ...more, inlineContent: inlineContent(items) });
const fin = (s: State): BlockId => {
  const f = getBlock(s, id("doc"))?.lastChildId;
  if (f === null || f === undefined) throw new Error("no final section");
  return f;
};
const items = (s: State, b: string) => getBlock(s, id(b))?.inlineContent?.items;

describe("mergeAdjacentBlocks — the survivor is R", () => {
  it("deletes ¶L: R holds L's content then its own; links + dirty ids", () => {
    const state = doc([para("p1", [text("hello")]), para("p2", [text(" world")])]);
    const F = fin(state);
    const result = mergeAdjacentBlocks(state, id("p1"), id("p2"));
    expect(result.survivorId).toBe("p2");
    expect(flowShape(result.state, "doc")).toBe('p2:"hello world"');
    expect(getBlock(result.state, id("p1"))).toBeNull();
    expect(getBlock(result.state, F)?.firstChildId).toBe("p2");
    expect(getBlock(result.state, F)?.lastChildId).toBe("p2");
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["p1", "p2", F]));
    assertInvariantI(result.state, "storage");
  });

  it("run-merging across the seam: equal attrs join, different attrs / an embed keep both", () => {
    const same = mergeAdjacentBlocks(doc([para("a", [text("ab", { bold: true })]), para("b", [text("cd", { bold: true })])]), id("a"), id("b")).state;
    expect(items(same, "b")).toEqual([{ kind: "text", text: "abcd", attrs: { bold: true } }]);
    const diff = mergeAdjacentBlocks(doc([para("a", [text("ab", { bold: true })]), para("b", [text("cd")])]), id("a"), id("b")).state;
    expect(items(diff, "b")).toEqual([{ kind: "text", text: "ab", attrs: { bold: true } }, { kind: "text", text: "cd", attrs: {} }]);
    const emb = mergeAdjacentBlocks(doc([para("a", [text("x"), embed("img")]), para("b", [text("y")])]), id("a"), id("b")).state;
    expect(items(emb, "b")).toMatchObject([{ text: "x" }, { kind: "embed", embedType: "img" }, { text: "y" }]);
    const multi = mergeAdjacentBlocks(doc([para("a", [text("a1"), text("a2", { italic: true })]), para("b", [text("b1", { italic: true }), text("b2")])]), id("a"), id("b")).state;
    expect(items(multi, "b")).toMatchObject([{ text: "a1" }, { text: "a2b1", attrs: { italic: true } }, { text: "b2" }]);
  });

  it("linked list: middle / first / last pairs and a pair inside an explicit section", () => {
    const four = () => doc([para("p1", [text("1")]), para("p2", [text("2")]), para("p3", [text("3")]), para("p4", [text("4")])]);
    const mid = mergeAdjacentBlocks(four(), id("p2"), id("p3")).state;
    expect(flowShape(mid, "doc")).toBe('p1:"1" p3:"23" p4:"4"');
    expect(getBlock(mid, id("p1"))?.nextSiblingId).toBe("p3");
    expect(getBlock(mid, id("p3"))?.prevSiblingId).toBe("p1");
    const first = four();
    const F = fin(first);
    const f = mergeAdjacentBlocks(first, id("p1"), id("p2")).state;
    expect(getBlock(f, F)?.firstChildId).toBe("p2");
    expect(getBlock(f, id("p2"))?.prevSiblingId).toBeNull();
    const last = four();
    const l = mergeAdjacentBlocks(last, id("p3"), id("p4")).state;
    expect(getBlock(l, fin(last))?.lastChildId).toBe("p4");
    expect(getBlock(l, id("p2"))?.nextSiblingId).toBe("p4");
    const nested = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "sec", lastChildId: "sec" }),
        buildBlock({ id: "sec", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "sec", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "sec", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const n = mergeAdjacentBlocks(nested, id("p1"), id("p2")).state;
    expect(getBlock(n, id("sec"))?.firstChildId).toBe("p2");
    expect(getBlock(n, id("sec"))?.lastChildId).toBe("p2");
    expect(getBlock(n, id("p2"))?.parentId).toBe("sec");
  });

  it("an embed-referenced body survives (no cascade delete)", () => {
    const state = doc(
      [para("p1", [text("see")]), para("p2", [embed("footnote-anchor", { contentBlockId: "fn-body" })])],
      [buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: inlineContent([text("footnote text")]) })],
    );
    const result = mergeAdjacentBlocks(state, id("p1"), id("p2"));
    expect(getEmbedContent(result.state, id("fn-body"))).not.toBeNull();
    expect(items(result.state, "p2")).toMatchObject([{ kind: "text", text: "see" }, { kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } }]);
  });

  it("does not mutate the pre-op snapshots", () => {
    const state = doc([para("p1", [text("a")]), para("p2", [text("b")])]);
    const before = getBlock(state, id("p1"));
    const result = mergeAdjacentBlocks(state, id("p1"), id("p2"));
    expect(result.state).not.toBe(state);
    expect(getBlock(state, id("p1"))).toBe(before);
    expect(before?.inlineContent?.items).toMatchObject([{ text: "a" }]);
  });
});

describe("mergeAdjacentBlocks — formatting (Google Docs / Quill: the FIRST paragraph wins unless it is an empty DEFAULT paragraph)", () => {
  it("non-empty L: L's type + attrs + ¶ props are written onto R key-wise (R's keys L lacks are cleared)", () => {
    const state = doc([
      { ...para("L", [text("ab")], { type: "heading", attrs: { level: 1 } }), markAttrs: { bold: true } },
      { ...para("R", [text("cd")], { attrs: { align: "center" } }), markAttrs: { italic: true } },
    ]);
    const s = mergeAdjacentBlocks(state, id("L"), id("R")).state;
    expect(flowShape(s, "doc")).toBe('R:"abcd"');
    expect(getBlock(s, id("R"))?.type).toBe("heading");
    expect(getBlock(s, id("R"))?.attrs).toEqual({ level: 1 });
    expect(getBlock(s, id("R"))?.markAttrs).toEqual({ bold: true });
  });

  it("non-empty L + EMPTY R of another type: R takes L's formatting", () => {
    const s = mergeAdjacentBlocks(doc([para("L", [text("ab")]), para("R", [], { type: "heading", attrs: { level: 2 } })]), id("L"), id("R")).state;
    expect(flowShape(s, "doc")).toBe('R:"ab"');
    expect(getBlock(s, id("R"))?.type).toBe("paragraph");
    expect(getBlock(s, id("R"))?.attrs).toEqual({});
  });

  it("an EMPTY HEADING L still wins: empty heading + normal \"x\" → heading \"x\"", () => {
    const s = mergeAdjacentBlocks(doc([para("L", [], { type: "heading", attrs: { level: 1 } }), para("R", [text("x")])]), id("L"), id("R")).state;
    expect(flowShape(s, "doc")).toBe('R:"x"');
    expect(getBlock(s, id("R"))?.type).toBe("heading");
    expect(getBlock(s, id("R"))?.attrs).toEqual({ level: 1 });
  });

  it("an EMPTY DEFAULT L loses: empty normal + heading \"x\" → heading \"x\"", () => {
    const s = mergeAdjacentBlocks(doc([para("L", []), para("R", [text("x")], { type: "heading", attrs: { level: 2 } })]), id("L"), id("R")).state;
    expect(flowShape(s, "doc")).toBe('R:"x"');
    expect(getBlock(s, id("R"))?.type).toBe("heading");
    expect(getBlock(s, id("R"))?.attrs).toEqual({ level: 2 });
  });

  it("both empty: one empty paragraph with R's id", () => {
    const s = mergeAdjacentBlocks(doc([para("L", []), para("R", [])]), id("L"), id("R")).state;
    expect(flowShape(s, "doc")).toBe('R:""');
  });
});

describe("mergeAdjacentBlocks — error cases", () => {
  // Common fixture: two adjacent leaves under doc.
  const adjacentFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
      ],
    });

  it("throws when leftId === rightId (cannot merge a block with itself)", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p1" as BlockId),
    ).toThrow(/same block/);
  });

  it("throws when the left block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "missing" as BlockId, "p2" as BlockId),
    ).toThrow(/left block ".+" not found/);
  });

  it("throws when the right block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "missing" as BlockId),
    ).toThrow(/right block ".+" not found/);
  });

  it("throws when the left block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the left block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the left container guard so a future
    // regression that drops it (|| → &&) is caught.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the right block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when the right block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the right container guard.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        // An object block: null inlineContent AND null firstChildId (an empty
        // SECTION is not in the read model).
        buildBlock({ id: "s", type: "horizontal-line", parentId: "doc", prevSiblingId: "p" }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when blocks have different parents", () => {
    // doc > [section1[p_a], section2[p_b]] — p_a and p_b are leaves but parented under different sections.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section1", lastChildId: "section2" }),
        buildBlock({ id: "section1", type: "section", parentId: "doc", nextSiblingId: "section2", firstChildId: "p_a", lastChildId: "p_a" }),
        buildBlock({ id: "p_a", type: "paragraph", parentId: "section1", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "section2", type: "section", parentId: "doc", prevSiblingId: "section1", firstChildId: "p_b", lastChildId: "p_b" }),
        buildBlock({ id: "p_b", type: "paragraph", parentId: "section2", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p_a" as BlockId, "p_b" as BlockId),
    ).toThrow(/different parents/);
  });

  it("throws when left.nextSiblingId !== rightId (non-adjacent — adjacency arm A)", () => {
    // doc > [p1, p2, p3] — try to merge p1 and p3 (skipping p2).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("c")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p3" as BlockId),
    ).toThrow(/not adjacent siblings/);
  });
});

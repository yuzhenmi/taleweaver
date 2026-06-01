import { describe, it, expect } from "vitest";
import { moveByCharacter, moveByWord, selectWord, expandSelection } from "./cursor-ops";
import { buildState, buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import { createPosition } from "../state";
import type { BlockId } from "../state";

describe("moveByCharacter (new) — within text", () => {
  it("advances forward by one ASCII grapheme", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 1 });
  });

  it("retreats backward by one ASCII grapheme", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 3), "backward");
    expect(out).toEqual({ blockId: "p", offset: 2 });
  });

  it("treats a flag emoji (4 UTF-16 code units) as one step", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("🇺🇸hi")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 4 });
  });

  it("retreats across an emoji as one step", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("🇺🇸hi")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 4), "backward");
    expect(out).toEqual({ blockId: "p", offset: 0 });
  });
});

describe("moveByCharacter (new) — embed handling", () => {
  it("advances past an embed by 1 offset unit", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab"), embed("fn-anchor", { contentBlockId: "fn1" }), text("cd")]),
        }),
      ],
    });
    // 'a''b'<embed>'c''d' → offsets 0..5 (text "ab"=2, embed=1, text "cd"=2; total 5).
    // From offset 2 (just past "ab", start of embed), forward should land at 3 (past the embed).
    const out = moveByCharacter(state, createPosition("p" as BlockId, 2), "forward");
    expect(out).toEqual({ blockId: "p", offset: 3 });
  });

  it("retreats past an embed by 1 offset unit", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab"), embed("fn-anchor", { contentBlockId: "fn1" }), text("cd")]),
        }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p" as BlockId, 3), "backward");
    expect(out).toEqual({ blockId: "p", offset: 2 });
  });
});

describe("moveByCharacter (new) — cross-block", () => {
  it("advances from end-of-block to offset 0 of next block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p1" as BlockId, 2), "forward");
    expect(out).toEqual({ blockId: "p2", offset: 0 });
  });

  it("retreats from offset 0 to end-of-content of previous block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const out = moveByCharacter(state, createPosition("p2" as BlockId, 0), "backward");
    expect(out).toEqual({ blockId: "p1", offset: 2 });
  });

  it("returns input unchanged at start-of-document (backward)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const out = moveByCharacter(state, pos, "backward");
    expect(out).toEqual(pos);
  });

  it("returns input unchanged at end-of-document (forward)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const out = moveByCharacter(state, pos, "forward");
    expect(out).toEqual(pos);
  });

  it("returns input unchanged for unknown blockId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const pos = createPosition("missing" as BlockId, 0);
    const out = moveByCharacter(state, pos, "forward");
    expect(out).toEqual(pos);
  });
});

describe("moveByWord (new)", () => {
  it("advances forward to end of next word within a text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 5 });
  });

  it("retreats backward to start of current/previous word within a text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p" as BlockId, 8), "backward");
    expect(out).toEqual({ blockId: "p", offset: 6 });
  });

  it("crosses block boundary to offset 0 when at end of last word in block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p1" as BlockId, 5), "forward");
    expect(out).toEqual({ blockId: "p2", offset: 0 });
  });

  it("crosses block boundary backward from offset 0 to last word start of previous block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello there")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const out = moveByWord(state, createPosition("p2" as BlockId, 0), "backward");
    expect(out).toEqual({ blockId: "p1", offset: 6 });
  });

  it("treats an embed as a word boundary (forward stops just before embed)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), embed("fn-anchor", { contentBlockId: "x" }), text("world")]),
        }),
      ],
    });
    // From offset 0, forward word lands at end of "hello" (5).
    const out = moveByWord(state, createPosition("p" as BlockId, 0), "forward");
    expect(out).toEqual({ blockId: "p", offset: 5 });
  });

  it("returns input unchanged at document boundaries", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(moveByWord(state, createPosition("p" as BlockId, 0), "backward")).toEqual(createPosition("p" as BlockId, 0));
    expect(moveByWord(state, createPosition("p" as BlockId, 2), "forward")).toEqual(createPosition("p" as BlockId, 2));
  });
});

describe("selectWord (new)", () => {
  it("returns the span of the word at the position", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = selectWord(state, createPosition("p" as BlockId, 3));
    expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
    expect(span.focus).toEqual({ blockId: "p", offset: 5 });
  });

  it("falls back to preceding word when position is on whitespace", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = selectWord(state, createPosition("p" as BlockId, 5)); // on the space
    expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
    expect(span.focus).toEqual({ blockId: "p", offset: 5 });
  });

  it("returns a collapsed span on an empty block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const span = selectWord(state, pos);
    expect(span.anchor).toEqual(pos);
    expect(span.focus).toEqual(pos);
  });

  it("returns a collapsed span when position falls on an embed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "x" })]),
        }),
      ],
    });
    const pos = createPosition("p" as BlockId, 0);
    const span = selectWord(state, pos);
    expect(span.anchor).toEqual(pos);
    expect(span.focus).toEqual(pos);
  });

  it("uses the lastWord fallback when position is squarely inside whitespace", () => {
    // Double-space between words: "hello  world" (offset 6 is interior of
    // whitespace, not at the edge of either word).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello  world")]) }),
      ],
    });
    const span = selectWord(state, createPosition("p" as BlockId, 6));
    expect(span.anchor).toEqual({ blockId: "p", offset: 0 });
    expect(span.focus).toEqual({ blockId: "p", offset: 5 });
  });
});

describe("expandSelection (new)", () => {
  it("moves focus forward by one grapheme, anchor unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const anchor = createPosition("p" as BlockId, 2);
    const focus = createPosition("p" as BlockId, 2);
    const out = expandSelection(state, { anchor, focus }, "forward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p", offset: 3 });
  });

  it("moves focus backward by one grapheme, anchor unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const anchor = createPosition("p" as BlockId, 0);
    const focus = createPosition("p" as BlockId, 3);
    const out = expandSelection(state, { anchor, focus }, "backward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p", offset: 2 });
  });

  it("crosses block boundary when focus is at block end", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    const anchor = createPosition("p1" as BlockId, 0);
    const focus = createPosition("p1" as BlockId, 2);
    const out = expandSelection(state, { anchor, focus }, "forward");
    expect(out.anchor).toEqual(anchor);
    expect(out.focus).toEqual({ blockId: "p2", offset: 0 });
  });
});

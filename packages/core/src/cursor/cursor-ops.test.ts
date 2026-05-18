import { describe, it, expect } from "vitest";
import { moveByCharacter } from "./cursor-ops";
import { buildState, buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";

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

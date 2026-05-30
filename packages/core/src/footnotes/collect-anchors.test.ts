import { describe, it, expect } from "vitest";
import { collectFootnoteAnchors } from "./collect-anchors";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "../state";
import {
  buildBlock,
  buildState,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";

/** A footnote-anchor EmbedItem pointing at `bodyRootId`. */
function fnAnchor(bodyRootId: string) {
  return embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: bodyRootId });
}

describe("collectFootnoteAnchors — no anchors", () => {
  it("returns empty for a doc with no footnote embeds", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world")]),
        }),
      ],
    });
    expect(collectFootnoteAnchors(state)).toEqual([]);
  });
});

describe("collectFootnoteAnchors — document order across blocks", () => {
  it("emits anchors in document order across multiple paragraphs", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p3",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("a"), fnAnchor("fb1")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([text("no anchor here")]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          inlineContent: inlineContent([text("b"), fnAnchor("fb2")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fb1", type: "footnote-body", parentId: null }),
        buildBlock({ id: "fb2", type: "footnote-body", parentId: null }),
      ],
    });
    const anchors = collectFootnoteAnchors(state);
    expect(anchors.map((a) => a.contentBlockId)).toEqual(["fb1", "fb2"]);
    expect(anchors[0]).toEqual({ contentBlockId: "fb1", blockId: "p1", sectionId: null });
    expect(anchors[1]).toEqual({ contentBlockId: "fb2", blockId: "p3", sectionId: null });
  });
});

describe("collectFootnoteAnchors — multiple anchors in one block", () => {
  it("emits in inlineContent order within a single block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("x"),
            fnAnchor("fbA"),
            text("y"),
            fnAnchor("fbB"),
            text("z"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fbA", type: "footnote-body", parentId: null }),
        buildBlock({ id: "fbB", type: "footnote-body", parentId: null }),
      ],
    });
    const anchors = collectFootnoteAnchors(state);
    expect(anchors.map((a) => a.contentBlockId)).toEqual(["fbA", "fbB"]);
    expect(anchors.every((a) => a.blockId === "p")).toBe(true);
  });
});

describe("collectFootnoteAnchors — sections", () => {
  it("tags each anchor with its enclosing section id (null before any section)", () => {
    // doc
    //  ├─ p0 (implicit/root section)      → anchor fb0, sectionId null
    //  ├─ section s1
    //  │   └─ p1                          → anchor fb1, sectionId s1
    //  └─ section s2
    //      └─ p2                          → anchor fb2, sectionId s2
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p0",
          lastChildId: "s2",
        }),
        buildBlock({
          id: "p0",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "s1",
          inlineContent: inlineContent([text("root "), fnAnchor("fb0")]),
        }),
        buildBlock({
          id: "s1",
          type: "section",
          parentId: "doc",
          prevSiblingId: "p0",
          nextSiblingId: "s2",
          firstChildId: "p1",
          lastChildId: "p1",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "s1",
          inlineContent: inlineContent([text("sec1 "), fnAnchor("fb1")]),
        }),
        buildBlock({
          id: "s2",
          type: "section",
          parentId: "doc",
          prevSiblingId: "s1",
          firstChildId: "p2",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "s2",
          inlineContent: inlineContent([text("sec2 "), fnAnchor("fb2")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fb0", type: "footnote-body", parentId: null }),
        buildBlock({ id: "fb1", type: "footnote-body", parentId: null }),
        buildBlock({ id: "fb2", type: "footnote-body", parentId: null }),
      ],
    });
    const anchors = collectFootnoteAnchors(state);
    expect(anchors).toEqual([
      { contentBlockId: "fb0", blockId: "p0", sectionId: null },
      { contentBlockId: "fb1", blockId: "p1", sectionId: "s1" },
      { contentBlockId: "fb2", blockId: "p2", sectionId: "s2" },
    ]);
  });
});

describe("collectFootnoteAnchors — ignores non-footnote / malformed embeds", () => {
  it("skips embeds of other types and footnote anchors without a contentBlockId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed("image", { src: "x.png" }),
            fnAnchor("fbReal"),
            // Footnote-anchor embed missing a contentBlockId — must be skipped.
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, {}),
            // Footnote-anchor embed with a non-string contentBlockId — skipped.
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: 42 }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fbReal", type: "footnote-body", parentId: null }),
      ],
    });
    const anchors = collectFootnoteAnchors(state);
    expect(anchors.map((a) => a.contentBlockId)).toEqual(["fbReal"]);
  });
});

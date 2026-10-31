import { describe, it, expect } from "vitest";
import {
  BOOKMARK_START_EMBED_TYPE,
  BOOKMARK_END_EMBED_TYPE,
  collectBookmarks,
  bookmarksRemovedBy,
} from "./bookmarks";
import { createPosition } from "./block-position";
import type { BlockId } from "./block-id";
import type { InlineItem } from "./inline-content";
import { buildBlock, buildDocument, inlineContent, text, embed } from "../test-utils/document-builders";

const S = (id: string): InlineItem => embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: id });
const E = (id: string): InlineItem => embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: id });

describe("bookmarks", () => {
  it("duplicate ids: the first start pairs with the first end after it; every other marker is inert", () => {
    // p: units 0 E | 1 "a" | 2 S | 3 "b" | 4 S | 5 "c" | 6 E | 7 "d" | 8 E;  q: S "e" E.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "q" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "q",
          inlineContent: inlineContent([E("x"), text("a"), S("x"), text("b"), S("x"), text("c"), E("x"), text("d"), E("x")]),
        }),
        buildBlock({ id: "q", type: "paragraph", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([S("x"), text("e"), E("x"), S("y")]) }),
      ],
    });
    const p = "p" as BlockId;
    expect([...collectBookmarks(document)]).toEqual([["x", { start: createPosition(p, 3), end: createPosition(p, 6) }]]);
  });

  it("a deletion removes a bookmark only by covering its start from the left and its end from the right", () => {
    const removed = (items: InlineItem[], from: number, to: number): string[] => [...bookmarksRemovedBy([{ items, from, to }])];
    // "ab" | S E | "cd": an EMPTY bookmark beside the deleted text is kept on either side.
    const empty = [text("ab"), S("x"), E("x"), text("cd")];
    expect(removed(empty, 0, 2)).toEqual([]);
    expect(removed(empty, 4, 6)).toEqual([]);
    // S "ab" E: exactly its text (markers just outside the span) removes it.
    expect(removed([S("x"), text("ab"), E("x")], 1, 3)).toEqual(["x"]);
  });
});

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { buildYBlock, buildYInlineItem, type YBlockInit } from "./y-block";
import type { BlockId } from "./block-id";

// Yjs forbids reading from a Y.Map / Y.Array / Y.Text that is not yet
// attached to a Y.Doc. buildYBlock returns a detached Y.Map (its caller —
// new-initial-state.ts / Layer 3 ops — performs the integration). For
// readability the tests attach the produced block to a throwaway Y.Doc
// before asserting against it.
function attach(value: Y.Map<unknown>): Y.Map<unknown> {
  const doc = new Y.Doc();
  doc.getMap("root").set("block", value);
  return value;
}

describe("y-block", () => {
  it("constructs a Y.Map with all block fields populated", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: { bold: true },
      parentId: "root" as BlockId,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: [] },
    };
    const yBlock = attach(buildYBlock(init));
    expect(yBlock.get("type")).toBe("paragraph");
    expect((yBlock.get("attrs") as Y.Map<unknown>).get("bold")).toBe(true);
    expect(yBlock.get("parentId")).toBe("root");
    expect(yBlock.get("prevSiblingId")).toBeNull();
    expect(yBlock.get("inlineContent")).toBeInstanceOf(Y.Array);
  });

  it("sets inlineContent to null for container blocks", () => {
    const init: YBlockInit = {
      type: "section",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: "p1" as BlockId,
      lastChildId: "p1" as BlockId,
      inlineContent: null,
    };
    const yBlock = attach(buildYBlock(init));
    expect(yBlock.get("inlineContent")).toBeNull();
    expect(yBlock.get("firstChildId")).toBe("p1");
  });

  it("populates Y.Text correctly for text items", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: {
        items: [{ kind: "text", text: "hello", attrs: { bold: true } }],
      },
    };
    const yBlock = attach(buildYBlock(init));
    const items = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    expect(items.length).toBe(1);
    const yItem = items.get(0);
    expect(yItem.get("kind")).toBe("text");
    const yText = yItem.get("text") as Y.Text;
    expect(yText.toString()).toBe("hello");
    const yAttrs = yItem.get("attrs") as Y.Map<unknown>;
    expect(yAttrs.get("bold")).toBe(true);
  });

  it("populates embed item fields", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: {
        items: [
          {
            kind: "embed",
            embedType: "image",
            attrs: {},
            properties: { src: "url" },
          },
        ],
      },
    };
    const yBlock = attach(buildYBlock(init));
    const items = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yItem = items.get(0);
    expect(yItem.get("kind")).toBe("embed");
    expect(yItem.get("embedType")).toBe("image");
    expect((yItem.get("properties") as Y.Map<unknown>).get("src")).toBe("url");
  });

  // T39: write-path guard. Constructing an inline embed item with a nested
  // Y type in `properties` (or `attrs`) must throw at construction so the
  // bad reference never enters the Y.Doc. The same Y type written into a
  // foreign Y.Doc via cross-doc paste would produce undefined CRDT
  // behavior, and a snapshot of such properties would be a live reference
  // rather than a value.
  describe("buildYInlineItem nested Y-type guard", () => {
    it("throws when an embed property is a Y.Map", () => {
      expect(() =>
        buildYInlineItem({
          kind: "embed",
          embedType: "image",
          attrs: {},
          properties: { nested: new Y.Map<unknown>() },
        }),
      ).toThrow(/nested Y types are not allowed/i);
    });

    it("throws when an embed property is a Y.Text", () => {
      expect(() =>
        buildYInlineItem({
          kind: "embed",
          embedType: "image",
          attrs: {},
          properties: { nested: new Y.Text() },
        }),
      ).toThrow(/nested Y types are not allowed/i);
    });

    it("throws when an embed attr is a Y.Array", () => {
      expect(() =>
        buildYInlineItem({
          kind: "embed",
          embedType: "image",
          attrs: { nested: new Y.Array<unknown>() },
          properties: {},
        }),
      ).toThrow(/nested Y types are not allowed/i);
    });
  });
});

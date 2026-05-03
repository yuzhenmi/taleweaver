import { describe, it, expect } from "vitest";
import { text, embed } from "./state-builders";

describe("text helper", () => {
  it("produces a TextItem with the given string and attrs", () => {
    const t = text("hello", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hello");
    expect(t.attrs).toEqual({ bold: true });
  });

  it("defaults attrs to empty bag", () => {
    const t = text("hi");
    expect(t.attrs).toEqual({});
  });
});

describe("embed helper", () => {
  it("produces an EmbedItem with the given type, properties, and attrs", () => {
    const e = embed("image", { src: "u" }, { link: "http://x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "u" });
    expect(e.attrs).toEqual({ link: "http://x" });
  });

  it("defaults properties and attrs to empty", () => {
    const e = embed("hard-break");
    expect(e.properties).toEqual({});
    expect(e.attrs).toEqual({});
  });
});

import { buildBlock, buildState } from "./state-builders";
import { createTestAllocator } from "../state/block-id";
import { createInlineContent } from "../state/inline-content";

describe("buildBlock", () => {
  it("produces a leaf block with given id, type, attrs, and inline content", () => {
    const b = buildBlock({
      id: "para-0",
      type: "paragraph",
      attrs: { textAlign: "left" },
      inlineContent: createInlineContent([text("hello")]),
    });
    expect(b.id).toBe("para-0");
    expect(b.type).toBe("paragraph");
    expect(b.attrs).toEqual({ textAlign: "left" });
    expect(b.inlineContent?.items).toHaveLength(1);
  });

  it("produces a container block with children", () => {
    const b = buildBlock({
      id: "doc-0",
      type: "document",
      firstChildId: "para-0",
      lastChildId: "para-1",
    });
    expect(b.firstChildId).toBe("para-0");
    expect(b.lastChildId).toBe("para-1");
    expect(b.inlineContent).toBeNull();
  });
});

describe("buildState", () => {
  it("produces a state with the given root and blocks", () => {
    const allocator = createTestAllocator();
    const docId = allocator.allocate();
    const paraId = allocator.allocate();
    const doc = buildBlock({
      id: docId,
      type: "document",
      firstChildId: paraId,
      lastChildId: paraId,
    });
    const para = buildBlock({
      id: paraId,
      type: "paragraph",
      parentId: docId,
      inlineContent: createInlineContent([text("hello")]),
    });
    const s = buildState({ rootId: docId, blocks: [doc, para] });
    expect(s.rootId).toBe(docId);
    expect(s.blocks.size).toBe(2);
    expect(s.blocks.get(docId)?.type).toBe("document");
    expect(s.blocks.get(paraId)?.type).toBe("paragraph");
  });
});

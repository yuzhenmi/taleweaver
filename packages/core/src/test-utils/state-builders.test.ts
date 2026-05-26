import { describe, it, expect } from "vitest";
import { buildBlock, buildState, text, embed, inlineContent } from "./state-builders";
import { getBlock, getEmbedContent } from "../state";
import type { BlockId } from "../state";

describe("state-builders (Y.Doc-backed)", () => {
  it("text() builds a TextItem with attrs", () => {
    const t = text("hi", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hi");
    expect(t.attrs).toEqual({ bold: true });
  });

  it("embed() builds an EmbedItem with embedType, props, attrs", () => {
    const e = embed("image", { src: "url" }, { link: "/x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "url" });
    expect(e.attrs).toEqual({ link: "/x" });
  });

  it("buildBlock returns a Block-shape object", () => {
    const b = buildBlock({ id: "p1", type: "paragraph", inlineContent: { items: [text("hi")] } });
    expect(b.id).toBe("p1");
    expect(b.type).toBe("paragraph");
    expect(b.inlineContent?.items.length).toBe(1);
  });

  it("buildState creates a State queryable via getBlock", () => {
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "root", inlineContent: { items: [text("hello")] } }),
      ],
    });
    expect(state.rootId).toBe("root");
    const root = getBlock(state, "root" as BlockId);
    expect(root?.firstChildId).toBe("p1");
    const p1 = getBlock(state, "p1" as BlockId);
    expect(p1?.inlineContent?.items[0]).toEqual({ kind: "text", text: "hello", attrs: {} });
  });
});

describe("buildState — embedContents", () => {
  it("creates an empty embedContents map when not provided", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getEmbedContent(state, "missing" as BlockId)).toBeNull();
  });

  it("populates embedContents from the optional parameter", () => {
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "root",
          inlineContent: inlineContent([
            embed("fn-anchor", { contentBlockId: "fn-body-1" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("footnote text")]),
        }),
      ],
    });
    const body = getEmbedContent(state, "fn-body-1" as BlockId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("fn-body");
    expect(body?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "footnote text" });
    // Embed-content blocks should NOT appear in the main blocks map.
    expect(getBlock(state, "fn-body-1" as BlockId)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { buildBlock, buildDocument, text, embed, inlineContent, finalSectionOf } from "./document-builders";
import { getBlock, getEmbedContent } from "../state";
import type { BlockId } from "../state";

describe("document-builders (Y.Doc-backed)", () => {
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

  it("buildDocument creates a Document queryable via getBlock", () => {
    const document = buildDocument({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "root", inlineContent: { items: [text("hello")] } }),
      ],
    });
    expect(document.rootId).toBe("root");
    // root → its final section → p1.
    expect(getBlock(document, "p1" as BlockId)?.parentId).toBe(finalSectionOf(document));
    expect(getBlock(document, finalSectionOf(document))?.firstChildId).toBe("p1");
    const p1 = getBlock(document, "p1" as BlockId);
    expect(p1?.inlineContent?.items[0]).toEqual({ kind: "text", text: "hello", attrs: {} });
  });
});

describe("buildDocument — embedContents", () => {
  it("creates an empty embedContents map when not provided", () => {
    const document = buildDocument({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getEmbedContent(document, "missing" as BlockId)).toBeNull();
  });

  it("populates embedContents from the optional parameter", () => {
    const document = buildDocument({
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
    const body = getEmbedContent(document, "fn-body-1" as BlockId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("fn-body");
    // A body root is a flow holder: its own inline content becomes the body flow's
    // first paragraph (terminated by its own ¶).
    const para = body?.firstChildId ? getEmbedContent(document, body.firstChildId) : null;
    expect(para?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "footnote text" });
    // Embed-content blocks should NOT appear in the main blocks map.
    expect(getBlock(document, "fn-body-1" as BlockId)).toBeNull();
  });
});

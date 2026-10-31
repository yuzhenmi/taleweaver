import { describe, it, expect } from "vitest";
import { insertTemplateBody } from "./insert-template-body";
import {
  getBlock,
  getTemplateContent,
  getTemplateContentIds,
} from "../document";
import { buildBlock, buildDocument, inlineContent } from "../../test-utils/document-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";

/**
 * `insertTemplateBody` — the Layer-3 primitive behind INSERT_HEADER /
 * INSERT_FOOTER (C.2c T8). In ONE transaction it allocates a CONTAINER body
 * ROOT block (`type: "template-body"`, parentId null) plus one empty paragraph
 * CHILD into the templateContents map, and links the CONTAINER onto the SECTION
 * block (the doc root for the implicit section) via `attrs.headerBlockId` /
 * `attrs.footerBlockId`. The container model (#326) lets Enter split the child
 * paragraph into siblings UNDER the one root, instead of orphaning a 2nd root.
 */
describe("insertTemplateBody", () => {
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([]),
        }),
      ],
    });

  it("creates a CONTAINER body root + one empty paragraph child and links the container on the doc root", () => {
    const document = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      document,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    // The body ROOT is a `template-body` CONTAINER (parentId null, no inline,
    // its only child is the paragraph below).
    const body = getTemplateContent(result.document, result.bodyRootId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("template-body");
    expect(body?.parentId).toBeNull();
    expect(body?.inlineContent).toBeNull();
    expect(body?.firstChildId).toBe(result.firstParagraphId);
    expect(body?.lastChildId).toBe(result.firstParagraphId);

    // The paragraph CHILD is an empty inline-bearing leaf under the container.
    const para = getTemplateContent(result.document, result.firstParagraphId);
    expect(para).not.toBeNull();
    expect(para?.type).toBe("paragraph");
    expect(para?.parentId).toBe(result.bodyRootId);
    expect(para?.prevSiblingId).toBeNull();
    expect(para?.nextSiblingId).toBeNull();
    expect(para?.firstChildId).toBeNull();
    expect(para?.lastChildId).toBeNull();
    expect(para?.inlineContent).toEqual({ items: [] });

    // ONLY the container root is enumerated as a template-content ROOT — the
    // paragraph child (parentId = root) is NOT (the #313 root-only contract).
    const rootIds = [...getTemplateContentIds(result.document)];
    expect(rootIds).toContain(result.bodyRootId);
    expect(rootIds).not.toContain(result.firstParagraphId);
    expect(rootIds.length).toBe(1);

    // The doc root carries the link attr → the CONTAINER root id.
    const docRoot = getBlock(result.document, "doc" as BlockId);
    expect(docRoot?.attrs.headerBlockId).toBe(result.bodyRootId);
    expect(docRoot?.attrs.footerBlockId).toBeUndefined();
  });

  it("creates + links a footer body (container) on footerBlockId", () => {
    const document = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      document,
      { region: "footer", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    const body = getTemplateContent(result.document, result.bodyRootId);
    expect(body?.type).toBe("template-body");
    expect(body?.parentId).toBeNull();
    expect(body?.firstChildId).toBe(result.firstParagraphId);
    expect(getTemplateContent(result.document, result.firstParagraphId)?.type).toBe("paragraph");

    const docRoot = getBlock(result.document, "doc" as BlockId);
    expect(docRoot?.attrs.footerBlockId).toBe(result.bodyRootId);
    expect(docRoot?.attrs.headerBlockId).toBeUndefined();
  });

  it("merges the link attr only (preserves other section attrs)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          attrs: { pageInlineSize: 480 },
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      document,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    const docRoot = getBlock(result.document, "doc" as BlockId);
    expect(docRoot?.attrs.pageInlineSize).toBe(480);
    expect(docRoot?.attrs.headerBlockId).toBe(result.bodyRootId);
  });

  it("dirtyIds covers the container root, the paragraph child, AND the doc root (the attr change)", () => {
    const document = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      document,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );
    expect(result.dirtyIds.has(result.bodyRootId)).toBe(true);
    expect(result.dirtyIds.has(result.firstParagraphId)).toBe(true);
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);
  });

  it("throws when the section block does not exist", () => {
    const document = fixture();
    const alloc = createTestAllocator("tpl");
    expect(() =>
      insertTemplateBody(
        document,
        { region: "header", sectionBlockId: "missing" as BlockId },
        alloc,
      ),
    ).toThrow();
  });
});

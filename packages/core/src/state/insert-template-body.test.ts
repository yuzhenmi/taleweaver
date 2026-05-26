import { describe, it, expect } from "vitest";
import { insertTemplateBody } from "./insert-template-body";
import {
  getBlock,
  getTemplateContent,
  getTemplateContentIds,
} from "./state";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import { createTestAllocator } from "./block-id";
import type { BlockId } from "./block-id";

/**
 * `insertTemplateBody` — the Layer-3 primitive behind INSERT_HEADER /
 * INSERT_FOOTER (C.2c T8). In ONE transaction it allocates a one-paragraph
 * template body ROOT block (parentId null) into the templateContents map and
 * links it onto the SECTION block (the doc root for the implicit section) via
 * `attrs.headerBlockId` / `attrs.footerBlockId`.
 */
describe("insertTemplateBody", () => {
  const fixture = () =>
    buildState({
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

  it("creates a one-paragraph header body (parentId null, empty inline) and links it on the doc root", () => {
    const state = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      state,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    // A new template body root exists in templateContents.
    const body = getTemplateContent(result.state, result.bodyRootId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("paragraph");
    expect(body?.parentId).toBeNull();
    expect(body?.firstChildId).toBeNull();
    expect(body?.lastChildId).toBeNull();
    expect(body?.inlineContent).toEqual({ items: [] });

    // It's enumerated as a template-content ROOT (so #313 root iterators pick it up).
    expect([...getTemplateContentIds(result.state)]).toContain(result.bodyRootId);

    // The doc root carries the link attr → the new body root id.
    const docRoot = getBlock(result.state, "doc" as BlockId);
    expect(docRoot?.attrs.headerBlockId).toBe(result.bodyRootId);
    expect(docRoot?.attrs.footerBlockId).toBeUndefined();
  });

  it("creates + links a footer body on footerBlockId", () => {
    const state = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      state,
      { region: "footer", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    const body = getTemplateContent(result.state, result.bodyRootId);
    expect(body?.type).toBe("paragraph");
    expect(body?.parentId).toBeNull();

    const docRoot = getBlock(result.state, "doc" as BlockId);
    expect(docRoot?.attrs.footerBlockId).toBe(result.bodyRootId);
    expect(docRoot?.attrs.headerBlockId).toBeUndefined();
  });

  it("merges the link attr only (preserves other section attrs)", () => {
    const state = buildState({
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
      state,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );

    const docRoot = getBlock(result.state, "doc" as BlockId);
    expect(docRoot?.attrs.pageInlineSize).toBe(480);
    expect(docRoot?.attrs.headerBlockId).toBe(result.bodyRootId);
  });

  it("dirtyIds covers BOTH the new body root and the doc root (the attr change)", () => {
    const state = fixture();
    const alloc = createTestAllocator("tpl");
    const result = insertTemplateBody(
      state,
      { region: "header", sectionBlockId: "doc" as BlockId },
      alloc,
    );
    expect(result.dirtyIds.has(result.bodyRootId)).toBe(true);
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);
  });

  it("throws when the section block does not exist", () => {
    const state = fixture();
    const alloc = createTestAllocator("tpl");
    expect(() =>
      insertTemplateBody(
        state,
        { region: "header", sectionBlockId: "missing" as BlockId },
        alloc,
      ),
    ).toThrow();
  });
});

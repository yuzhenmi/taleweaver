import { TEST_RESOLVER } from "../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./create-empty-document";
import { getBlock } from "./document";
import type { BlockId } from "./block-id";

describe("createEmptyDocument", () => {
  it("returns a Document with a non-empty rootId", () => {
    const document = createEmptyDocument({ resolver: TEST_RESOLVER });
    expect(document.rootId).toBeTruthy();
  });

  it("populates the root block as a document whose final section holds one empty paragraph", () => {
    const document = createEmptyDocument({ resolver: TEST_RESOLVER });
    const root = getBlock(document, document.rootId);
    expect(root?.type).toBe("document");
    // Rev 11: the root always holds its final section (Word's body sectPr).
    const section = root === null || root.firstChildId === null ? null : getBlock(document, root.firstChildId);
    expect(section?.type).toBe("section");
    expect(root?.lastChildId).toBe(section?.id);
    const child = section === null || section.firstChildId === null ? null : getBlock(document, section.firstChildId);
    expect(child?.type).toBe("paragraph");
    expect(child?.parentId).toBe(section?.id);
    expect(child?.inlineContent?.items).toEqual([]);
  });

  it("uses the provided allocator for new ids when supplied", () => {
    const ids: string[] = [];
    const document = createEmptyDocument({ resolver: TEST_RESOLVER,
      allocator: {
        allocate: () => {
          const id = `test-${ids.length}` as BlockId;
          ids.push(id);
          return id;
        },
      },
    });
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(document.rootId).toBe(ids[0]);
  });
});

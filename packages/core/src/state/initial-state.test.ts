import { TEST_RESOLVER } from "../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./initial-state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";

describe("createEmptyDocument", () => {
  it("returns a State with a non-empty rootId", () => {
    const state = createEmptyDocument({ resolver: TEST_RESOLVER });
    expect(state.rootId).toBeTruthy();
  });

  it("populates the root block as a document whose final section holds one empty paragraph", () => {
    const state = createEmptyDocument({ resolver: TEST_RESOLVER });
    const root = getBlock(state, state.rootId);
    expect(root?.type).toBe("document");
    // Rev 11: the root always holds its final section (Word's body sectPr).
    const section = root === null || root.firstChildId === null ? null : getBlock(state, root.firstChildId);
    expect(section?.type).toBe("section");
    expect(root?.lastChildId).toBe(section?.id);
    const child = section === null || section.firstChildId === null ? null : getBlock(state, section.firstChildId);
    expect(child?.type).toBe("paragraph");
    expect(child?.parentId).toBe(section?.id);
    expect(child?.inlineContent?.items).toEqual([]);
  });

  it("uses the provided allocator for new ids when supplied", () => {
    const ids: string[] = [];
    const state = createEmptyDocument({ resolver: TEST_RESOLVER,
      allocator: {
        allocate: () => {
          const id = `test-${ids.length}` as BlockId;
          ids.push(id);
          return id;
        },
      },
    });
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(state.rootId).toBe(ids[0]);
  });
});

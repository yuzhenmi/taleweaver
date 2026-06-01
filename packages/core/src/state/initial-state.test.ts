import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./initial-state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";

describe("createEmptyDocument", () => {
  it("returns a State with a non-empty rootId", () => {
    const state = createEmptyDocument();
    expect(state.rootId).toBeTruthy();
  });

  it("populates the root block as a document with one paragraph child", () => {
    const state = createEmptyDocument();
    const root = getBlock(state, state.rootId);
    expect(root).not.toBeNull();
    expect(root!.type).toBe("document");
    expect(root!.firstChildId).toBeTruthy();
    const childId = root!.firstChildId!;
    const child = getBlock(state, childId);
    expect(child).not.toBeNull();
    expect(child!.type).toBe("paragraph");
    expect(child!.parentId).toBe(state.rootId);
    expect(child!.inlineContent?.items).toEqual([]);
  });

  it("uses the provided allocator for new ids when supplied", () => {
    const ids: string[] = [];
    const state = createEmptyDocument({
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

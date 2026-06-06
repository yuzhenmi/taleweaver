import { describe, it, expect } from "vitest";
import { migrateListStructure } from "./migrate-list-structure";
import { getBlock } from "./index";
import { buildState, buildBlock } from "../test-utils/state-builders";
import type { BlockId } from "./index";

// OLD structural shape: a `list` container holding two `list-item`s.
function structuralDoc() {
  return buildState({
    rootId: "root",
    blocks: [
      buildBlock({ id: "root", type: "doc", firstChildId: "list1", lastChildId: "list1" }),
      buildBlock({ id: "list1", type: "list", parentId: "root", firstChildId: "i1", lastChildId: "i2", attrs: { listType: "ordered" } }),
      buildBlock({ id: "i1", type: "list-item", parentId: "list1", nextSiblingId: "i2", inlineContent: { items: [] } }),
      buildBlock({ id: "i2", type: "list-item", parentId: "list1", prevSiblingId: "i1", inlineContent: { items: [] } }),
    ],
  });
}

describe("migrateListStructure", () => {
  it("reparents list-items to flat siblings under the container's parent and deletes the container", () => {
    const migrated = migrateListStructure(structuralDoc());
    expect(getBlock(migrated, "list1" as BlockId)).toBeNull();
    expect(getBlock(migrated, "i1" as BlockId)?.parentId).toBe("root");
    expect(getBlock(migrated, "i2" as BlockId)?.parentId).toBe("root");
  });

  it("assigns one listId per container and listLevel 0 at top level", () => {
    const migrated = migrateListStructure(structuralDoc());
    const i1 = getBlock(migrated, "i1" as BlockId);
    const i2 = getBlock(migrated, "i2" as BlockId);
    expect(i1?.attrs.listId).toBeDefined();
    expect(i1?.attrs.listId).toBe(i2?.attrs.listId);
    expect(i1?.attrs.listLevel).toBe(0);
  });

  it("nested sublist: sub-list items get a higher listLevel and share the top-level listId", () => {
    // OLD structural: root > list1 > [i1, i2, list2 > [i3, i4]]
    const nested = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "list1", lastChildId: "list1" }),
        buildBlock({ id: "list1", type: "list", parentId: "root", firstChildId: "i1", lastChildId: "list2", attrs: { listType: "ordered" } }),
        buildBlock({ id: "i1", type: "list-item", parentId: "list1", nextSiblingId: "i2", inlineContent: { items: [] } }),
        buildBlock({ id: "i2", type: "list-item", parentId: "list1", prevSiblingId: "i1", nextSiblingId: "list2", inlineContent: { items: [] } }),
        buildBlock({ id: "list2", type: "list", parentId: "list1", prevSiblingId: "i2", firstChildId: "i3", lastChildId: "i4", attrs: { listType: "ordered" } }),
        buildBlock({ id: "i3", type: "list-item", parentId: "list2", nextSiblingId: "i4", inlineContent: { items: [] } }),
        buildBlock({ id: "i4", type: "list-item", parentId: "list2", prevSiblingId: "i3", inlineContent: { items: [] } }),
      ],
    });
    const migrated = migrateListStructure(nested);

    // Both containers removed; all four items flattened under root.
    expect(getBlock(migrated, "list1" as BlockId)).toBeNull();
    expect(getBlock(migrated, "list2" as BlockId)).toBeNull();
    for (const id of ["i1", "i2", "i3", "i4"] as const) {
      expect(getBlock(migrated, id as BlockId)?.parentId).toBe("root");
    }

    // i1/i2 at level 0; i3/i4 (from the sublist) at level 1 — the outer-list
    // pass must NOT overwrite the inner items' level back to 0.
    expect(getBlock(migrated, "i1" as BlockId)?.attrs.listLevel).toBe(0);
    expect(getBlock(migrated, "i2" as BlockId)?.attrs.listLevel).toBe(0);
    expect(getBlock(migrated, "i3" as BlockId)?.attrs.listLevel).toBe(1);
    expect(getBlock(migrated, "i4" as BlockId)?.attrs.listLevel).toBe(1);

    // All four share one listId (one nested-list group → one instance).
    const listId = getBlock(migrated, "i1" as BlockId)?.attrs.listId;
    expect(listId).toBeDefined();
    for (const id of ["i2", "i3", "i4"] as const) {
      expect(getBlock(migrated, id as BlockId)?.attrs.listId).toBe(listId);
    }

    // Document order preserved: i1, i2, i3, i4.
    expect(getBlock(migrated, "root" as BlockId)?.firstChildId).toBe("i1");
    expect(getBlock(migrated, "i2" as BlockId)?.nextSiblingId).toBe("i3");
  });

  it("is a no-op (identity) on a doc with no list containers", () => {
    const plain = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "root", inlineContent: { items: [] } }),
      ],
    });
    expect(migrateListStructure(plain)).toBe(plain);
  });
});
